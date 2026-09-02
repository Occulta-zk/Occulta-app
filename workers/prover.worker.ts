/**
 * ZK Prover Web Worker (build spec §2, §4.1, SECURITY.md #5).
 *
 * ALL proving happens here — never on the main thread (SECURITY.md #5).
 * Running snarkjs's WebAssembly on the main thread freezes the tab and makes the app
 * look like it has crashed; on a depth-20 Merkle + Poseidon circuit this can take
 * 10-30 seconds on a mid-range phone (build spec §2).
 *
 * Message protocol (main thread → worker):
 *   { type: 'prove', circuitName, wasmUrl, zkeyUrl, inputs }
 *   { type: 'cancel' }
 *
 * Message protocol (worker → main thread):
 *   { type: 'downloading', progress, totalBytes }
 *   { type: 'compiling', phase }
 *   { type: 'proving', phase, estimatedMs }
 *   { type: 'done', proof, publicSignals, provingTimeMs }
 *   { type: 'error', message }
 *   { type: 'cancelled' }
 *
 * Security notes:
 *   - This worker receives witness inputs from the main thread via structured clone.
 *     The inputs may contain private signals (nullifier preimage, randomness). They
 *     are used solely to compute the witness; they are never posted back, never logged.
 *   - The WASM and .zkey files are fetched from the same origin (or a CDN with a
 *     matching origin in CSP connect-src). They are cached in the worker's memory for
 *     the duration of this instantiation to avoid re-downloading per proof.
 *   - `cancel` is handled cooperatively: the worker posts 'cancelled' and terminates
 *     the current operation; the main thread should then terminate the worker.
 */

// ─── Cancellation token ────────────────────────────────────────────────────────

let cancelled = false;

function checkCancelled(): void {
  if (cancelled) throw new CancellationError();
}

class CancellationError extends Error {
  constructor() {
    super('Proof generation was cancelled by the user');
    this.name = 'CancellationError';
  }
}

// ─── Artefact cache (per-worker lifetime) ────────────────────────────────────

const artefactCache = new Map<string, ArrayBuffer>();

/**
 * Fetches a binary artefact with progress reporting and caching.
 * Never re-downloads within a single worker lifetime.
 */
async function fetchWithProgress(
  url: string,
  onProgress: (loaded: number, total: number) => void,
): Promise<ArrayBuffer> {
  const cached = artefactCache.get(url);
  if (cached) return cached;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch artefact ${url}: HTTP ${response.status}`);
  }

  const contentLength = response.headers.get('Content-Length');
  const total = contentLength ? parseInt(contentLength, 10) : 0;

  if (!response.body) {
    // No streaming — fall back to a single read
    const buf = await response.arrayBuffer();
    artefactCache.set(url, buf);
    onProgress(buf.byteLength, buf.byteLength);
    return buf;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    checkCancelled();
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total || loaded);
  }

  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const buf = merged.buffer;
  artefactCache.set(url, buf);
  return buf;
}

// ─── snarkjs loading ──────────────────────────────────────────────────────────

/**
 * snarkjs is loaded dynamically so it stays out of the initial bundle. It is only
 * imported inside the worker, which is itself only instantiated when a proof is
 * needed (build spec §2, §8).
 *
 * snarkjs's `groth16.fullProve` expects `wasm`/`zkey` as in-memory file objects —
 * `{type:'mem', data:Uint8Array}` — not raw ArrayBuffers (verified live 2026-09-02
 * against snarkjs@0.7.6's wtns_utils.js and groth16_prove.js; see types/snarkjs.d.ts
 * and the identical, independently-verified note in @occulta/core's src/proving.ts).
 */
async function loadSnarkjs(): Promise<typeof import('snarkjs')> {
  try {
    return await import('snarkjs');
  } catch {
    throw new Error(
      'Failed to load the snarkjs proving library. Check your network connection and try again.',
    );
  }
}

// ─── Proof timing estimation ──────────────────────────────────────────────────

/**
 * Returns a rough estimate of proving time in milliseconds, based on constraint count.
 * These numbers are calibrated against snarkjs Groth16 on desktop Chrome (build spec §2).
 * The worker updates the estimate as the proof progresses.
 */
function estimateProvingTimeMs(constraintCount: number): number {
  // Groth16 proving cost grows roughly linearly with constraint count.
  // Calibrated: ~100k constraints ≈ 3s desktop, ≈ 10s mobile.
  // Err on the high side — a pleasant surprise beats a timeout.
  return Math.max(2000, Math.ceil(constraintCount * 0.035));
}

// ─── Main message handler ─────────────────────────────────────────────────────

interface ProveMessage {
  type: 'prove';
  circuitName: string;
  wasmUrl: string;
  zkeyUrl: string;
  /** Witness inputs — may include private signals. Never post back. */
  inputs: Record<string, unknown>;
  /** Constraint count for time estimation. */
  constraintCount?: number;
}

interface CancelMessage {
  type: 'cancel';
}

type WorkerMessage = ProveMessage | CancelMessage;

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;

  if (msg.type === 'cancel') {
    cancelled = true;
    self.postMessage({ type: 'cancelled' });
    return;
  }

  if (msg.type !== 'prove') return;

  cancelled = false;
  const startMs = performance.now();

  try {
    // 1. Load snarkjs
    self.postMessage({ type: 'compiling', phase: 'Loading prover library…' });
    const snarkjs = await loadSnarkjs();
    checkCancelled();

    // 2. Fetch WASM artefact
    self.postMessage({ type: 'compiling', phase: 'Downloading circuit WASM…' });
    const wasmBuffer = await fetchWithProgress(msg.wasmUrl, (loaded, total) => {
      self.postMessage({ type: 'downloading', progress: loaded, totalBytes: total });
    });
    checkCancelled();

    // 3. Fetch .zkey artefact
    self.postMessage({ type: 'compiling', phase: 'Downloading proving key…' });
    const zkeyBuffer = await fetchWithProgress(msg.zkeyUrl, (loaded, total) => {
      self.postMessage({ type: 'downloading', progress: loaded, totalBytes: total });
    });
    checkCancelled();

    // 4. Estimate proving time
    const estimatedMs = estimateProvingTimeMs(msg.constraintCount ?? 100_000);
    self.postMessage({
      type: 'proving',
      phase: 'Generating proof…',
      estimatedMs,
    });

    // 5. Generate proof
    // NOTE: private inputs in `msg.inputs` are used here and nowhere else.
    // They are not posted back, not logged, not stored anywhere in this worker.
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      msg.inputs,
      { type: 'mem', data: new Uint8Array(wasmBuffer) },
      { type: 'mem', data: new Uint8Array(zkeyBuffer) },
    );
    checkCancelled();

    const provingTimeMs = Math.round(performance.now() - startMs);

    self.postMessage({
      type: 'done',
      // `proof` already carries `protocol: 'groth16'` — snarkjs sets it itself.
      proof,
      publicSignals,
      provingTimeMs,
    });
  } catch (err) {
    if (err instanceof CancellationError) {
      self.postMessage({ type: 'cancelled' });
      return;
    }
    // Security: never include witness inputs or private signals in error messages.
    const message =
      err instanceof Error ? sanitiseErrorMessage(err.message) : 'Unknown prover error';
    self.postMessage({ type: 'error', message });
  }
};

/**
 * Strips any string that looks like a private signal from an error message.
 * Prover errors can surface internal state — we sanitise before posting to main thread.
 */
function sanitiseErrorMessage(raw: string): string {
  return (
    raw
      // Strip long hex strings that could be witness values
      .replace(/0x[0-9a-fA-F]{16,}/g, '[private]')
      // Strip anything that looks like a snarkjs field element (large decimal)
      .replace(/\b\d{15,}\b/g, '[field_element]')
      // Truncate to a reasonable length
      .slice(0, 512)
  );
}
