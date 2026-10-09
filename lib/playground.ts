/**
 * Playground support: the fixture-circuit manifest, witness-input validation, and the
 * failure-mode classifier that turns "verification failed" into a named cause.
 *
 * No cryptography lives here. Verification itself is injected (`VerifyFn`) — in the app it
 * is snarkjs's `groth16.verify` running inside `workers/prover.worker.ts`, the same call
 * `@occulta/core`'s `verifyLocal` makes. The Poseidon check compares a circuit's output
 * against a published reference vector; it never computes a hash.
 */
import { z } from 'zod';

// ─── Fixture manifest ─────────────────────────────────────────────────────────

const artefactSchema = z.object({
  /** Same-origin path the worker fetches. Never an absolute URL. */
  path: z.string().startsWith('/'),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const poseidonVectorSchema = z.object({
  inputs: z.array(z.string().regex(/^\d+$/)),
  output: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

const poseidonReferenceSchema = z.object({
  /** Human-readable parameter set, e.g. "BN254 t=3 (circomlib)". */
  label: z.string(),
  /** Repository, commit, and path the vectors were copied from. */
  source: z.string(),
  vectors: z.array(poseidonVectorSchema),
});

export const fixtureManifestSchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string(),
  /** Always "dev-fixture" until circuits ship from occulta-sdk. Rendered on the page. */
  status: z.literal('dev-fixture'),
  curve: z.literal('bn254'),
  constraintCount: z.number().int().positive(),
  /** Public signals in `public.json` order: outputs first, then public inputs. */
  publicSignals: z.array(z.string()).min(1),
  privateInputs: z.array(z.string()),
  publicInputs: z.array(z.string()),
  /** Which public signal holds Poseidon(privateInputs), for the reference-vector check. */
  poseidonOutputSignal: z.string(),
  example: z.record(z.string(), z.string().regex(/^\d+$/)),
  artefacts: z.object({
    wasm: artefactSchema,
    zkey: artefactSchema,
    vkey: artefactSchema,
    /** VK from a second, independent setup of the same circuit — fault injection only. */
    vkeyOtherSetup: artefactSchema,
  }),
  poseidonReference: poseidonReferenceSchema,
  /** A different parameter set's vectors — fault injection only. */
  poseidonForeignReference: poseidonReferenceSchema,
  setup: z.object({ ptau: z.string(), warning: z.string() }),
  toolchain: z.object({ circom: z.string(), circomlib: z.string(), snarkjs: z.string() }),
});

export type FixtureManifest = z.infer<typeof fixtureManifestSchema>;
export type PoseidonReference = z.infer<typeof poseidonReferenceSchema>;

export const FIXTURE_MANIFEST_URL = '/fixtures/playground/poseidon_preimage.json';

export async function loadFixtureManifest(url = FIXTURE_MANIFEST_URL): Promise<FixtureManifest> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load the playground circuit from ${url}: HTTP ${response.status}`);
  }
  return fixtureManifestSchema.parse(await response.json());
}

// ─── Witness-input validation ─────────────────────────────────────────────────

/** BN254 scalar field modulus. Every circuit input must be a canonical element below it. */
export const BN254_FR_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export type InputErrors = Partial<Record<string, string>>;

/**
 * Checks every circuit input is a canonical BN254 field element written in decimal.
 * Error messages name the field, never echo the value — some of these are private.
 */
export function validateInputs(names: readonly string[], values: Record<string, string>) {
  const errors: InputErrors = {};
  for (const name of names) {
    const raw = (values[name] ?? '').trim();
    if (raw === '') {
      errors[name] = 'Required.';
    } else if (!/^\d+$/.test(raw)) {
      errors[name] = 'Must be a non-negative whole number in decimal.';
    } else if (BigInt(raw) >= BN254_FR_MODULUS) {
      errors[name] = 'Must be smaller than the BN254 field modulus.';
    }
  }
  return errors;
}

// ─── Failure-mode classification ──────────────────────────────────────────────

export interface Groth16VKeyLike {
  readonly nPublic: number;
}

/** `snarkjs.groth16.verify`-shaped. Must return false (not throw) for an invalid proof. */
export type VerifyFn = (publicSignals: string[]) => Promise<boolean>;

export type Diagnosis =
  | { kind: 'verified' }
  | {
      kind: 'signal-order-mismatch';
      /** `correctOrder[i]` is the index in the submitted array that belongs at position i. */
      correctOrder: number[];
    }
  | { kind: 'vk-mismatch'; reason: 'public-count' | 'no-ordering-verifies'; detail: string };

/** Above this many public signals the n! ordering search is skipped. 6! = 720 pairings. */
export const MAX_SIGNALS_FOR_ORDER_SEARCH = 5;

/**
 * Verifies a proof and, if it fails, works out why.
 *
 * 1. A VK whose `nPublic` differs from the number of public signals belongs to another
 *    circuit. That is certain, so no pairing check is spent on it.
 * 2. If the proof verifies as submitted, done.
 * 3. Otherwise every other ordering of the public signals is tried. If one verifies, the
 *    proof and VK are fine and the caller encoded the signals in the wrong order — the most
 *    common integration bug, and invisible without this search.
 * 4. If no ordering verifies, the VK does not belong to the proving key that produced the
 *    proof: a VK registered for a different circuit, or from a different trusted setup.
 */
export async function diagnoseVerification(
  vkey: Groth16VKeyLike,
  publicSignals: readonly string[],
  verify: VerifyFn,
): Promise<Diagnosis> {
  if (vkey.nPublic !== publicSignals.length) {
    return {
      kind: 'vk-mismatch',
      reason: 'public-count',
      detail:
        `The verification key expects ${vkey.nPublic} public signal(s) but the proof has ` +
        `${publicSignals.length}. This VK was generated for a different circuit.`,
    };
  }

  if (await verify([...publicSignals])) return { kind: 'verified' };

  if (publicSignals.length > 1 && publicSignals.length <= MAX_SIGNALS_FOR_ORDER_SEARCH) {
    for (const order of permutations(publicSignals.length)) {
      if (order.every((v, i) => v === i)) continue; // already tried as submitted
      if (await verify(order.map((i) => publicSignals[i]!))) {
        return { kind: 'signal-order-mismatch', correctOrder: order };
      }
    }
  }

  return {
    kind: 'vk-mismatch',
    reason: 'no-ordering-verifies',
    detail:
      'The proof does not verify under any ordering of its public signals. The verification ' +
      'key does not match the proving key that produced this proof — it was registered for ' +
      'a different circuit, or comes from a different trusted setup of the same circuit.',
  };
}

function* permutations(n: number): Generator<number[]> {
  const items = Array.from({ length: n }, (_, i) => i);
  function* go(prefix: number[], rest: number[]): Generator<number[]> {
    if (rest.length === 0) {
      yield prefix;
      return;
    }
    for (let i = 0; i < rest.length; i++) {
      yield* go([...prefix, rest[i]!], [...rest.slice(0, i), ...rest.slice(i + 1)]);
    }
  }
  yield* go([], items);
}

// ─── Poseidon parameter check ─────────────────────────────────────────────────

export type PoseidonCheck =
  | { kind: 'match'; reference: string }
  | { kind: 'mismatch'; reference: string; expected: bigint; actual: bigint }
  | { kind: 'no-vector'; reference: string };

/**
 * Compares the circuit's Poseidon output against a published reference vector for the same
 * inputs. A proof can verify perfectly and still be useless on-chain if the circuit was
 * compiled with different Poseidon parameters (round constants, MDS, arity) than the
 * contract hashes with — the commitment it proves membership of simply won't exist there.
 *
 * Only inputs that appear in the reference set can be checked: this app does not compute
 * Poseidon itself, and the SDK that does is not installable yet (see lib/occulta.ts).
 */
export function checkPoseidonOutput(
  reference: PoseidonReference,
  inputs: readonly string[],
  circuitOutput: string,
): PoseidonCheck {
  const key = inputs.map((v) => BigInt(v).toString()).join(',');
  const vector = reference.vectors.find((v) => v.inputs.join(',') === key);
  if (!vector) return { kind: 'no-vector', reference: reference.label };
  const expected = BigInt(vector.output);
  const actual = BigInt(circuitOutput);
  return expected === actual
    ? { kind: 'match', reference: reference.label }
    : { kind: 'mismatch', reference: reference.label, expected, actual };
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}
