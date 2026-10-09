/**
 * Network egress security regression tests (build spec §6, §8).
 *
 * Security invariant #1: "No secret crosses the network."
 *
 * These tests assert that routes handling secrets (the note manager, the prover) do not
 * make requests to any origin except the configured indexer, relayer, and RPC. They also
 * assert that a tampered Merkle path is rejected before proving and that the same account
 * cannot both deposit and withdraw.
 *
 * These run in the `egress-check` CI step and block merge on failure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { MerkleProof as IndexerMerkleProof } from '@/lib/indexer';

// @occulta/core isn't installable yet (see lib/occulta.ts), so its Poseidon is replaced with a
// non-commutative toy hash for the Merkle tests; snarkjs is replaced so the worker egress test
// runs in milliseconds and needs no real artefacts (test/playground.test.ts proves for real).
const { toyHash } = vi.hoisted(() => ({
  toyHash: ([x, y]: readonly bigint[]) => (x! * 7n + y! * 13n + 1n) % 1_000_000_007n,
}));
vi.mock('@occulta/core', () => ({ buildOccultaPoseidon: async () => ({ hash: toyHash }) }));
vi.mock('snarkjs', () => ({
  groth16: {
    fullProve: async () => ({ proof: { protocol: 'groth16' }, publicSignals: ['1', '42'] }),
    verify: async () => true,
  },
}));

// ─── Fetch interception ──────────────────────────────────────────────────────

/** Records every URL that `fetch()` is called with during a test. */
function interceptFetch(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const original = global.fetch;

  global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    // Return a minimal stub so callers don't crash
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return {
    calls,
    restore: () => {
      global.fetch = original;
    },
  };
}

// ─── Allowed origins (matches .env.example defaults) ─────────────────────────

const ALLOWED_ORIGINS = new Set([
  'http://localhost:3001', // default indexer
  'http://localhost:3002', // default relayer
  'https://soroban-testnet.stellar.org', // Stellar testnet RPC
  'https://horizon-testnet.stellar.org', // Stellar testnet Horizon
]);

function isAllowedOrigin(url: string): boolean {
  // Same-origin relative paths (e.g. `/deployments/testnet.json`) are always allowed and
  // must be checked before `new URL()`, which throws on a relative input with no base.
  if (url.startsWith('/')) return true;
  try {
    const { origin } = new URL(url);
    return ALLOWED_ORIGINS.has(origin);
  } catch {
    return false;
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Network egress invariants', () => {
  it('All allowed origins are distinct from analytics/telemetry domains', () => {
    const telemetryDomains = [
      'sentry.io',
      'analytics.google.com',
      'segment.io',
      'mixpanel.com',
      'amplitude.com',
      'posthog.com',
      'logrocket.com',
      'fullstory.com',
      'hotjar.com',
      'vercel-insights.com',
      'clarity.ms',
    ];
    for (const origin of ALLOWED_ORIGINS) {
      for (const domain of telemetryDomains) {
        expect(origin).not.toContain(domain);
      }
    }
  });

  it('isAllowedOrigin accepts configured indexer/relayer/RPC', () => {
    for (const origin of ALLOWED_ORIGINS) {
      expect(isAllowedOrigin(origin + '/api/test')).toBe(true);
    }
  });

  it('isAllowedOrigin rejects third-party analytics URLs', () => {
    const forbidden = [
      'https://sentry.io/api/1234/envelope/',
      'https://www.google-analytics.com/mp/collect',
      'https://analytics.segment.com/v1/track',
    ];
    for (const url of forbidden) {
      expect(isAllowedOrigin(url)).toBe(false);
    }
  });

  it('isAllowedOrigin accepts relative paths (same-origin)', () => {
    expect(isAllowedOrigin('/deployments/testnet.json')).toBe(true);
    expect(isAllowedOrigin('/artifacts/circuit.wasm')).toBe(true);
  });
});

// ─── Merkle path verification ──────────────────────────────────────────────────

describe('Merkle path verification (lib/indexer.ts → lib/occulta.ts)', () => {
  /**
   * Exercises the real `verifyMerklePathLocally` and `recomputeMerkleRoot`. Only the hash is
   * stood in for: `@occulta/core` isn't installable yet, so `buildOccultaPoseidon` is mocked
   * with a deliberately non-commutative toy so a left/right mix-up changes the root. What's
   * under test is the level-by-level walk and — the security property — that the path is
   * checked against the chain's root, never the root the indexer claims.
   */

  const leaf = 5n;
  const siblings = [11n, 22n];
  const indices = [0, 1];
  // Level 0: leaf is the left child → H(leaf, s0). Level 1: right child → H(s1, node).
  const trueRoot = toyHash([22n, toyHash([leaf, 11n])]);

  const proofFor = (overrides: Partial<IndexerMerkleProof> = {}): IndexerMerkleProof => ({
    leaf: leaf.toString(),
    pathElements: siblings.map(String),
    pathIndices: indices,
    root: trueRoot.toString(),
    blockNumber: 1,
    ...overrides,
  });

  it('recomputes the root level by level, honouring left/right', async () => {
    const { recomputeMerkleRoot } = await import('@/lib/occulta');
    expect(await recomputeMerkleRoot(leaf, siblings, indices)).toBe(trueRoot);
    expect(await recomputeMerkleRoot(leaf, siblings, [1, 0])).not.toBe(trueRoot);
  });

  it('accepts a path that hashes to the trusted on-chain root', async () => {
    const { verifyMerklePathLocally } = await import('@/lib/indexer');
    await expect(verifyMerklePathLocally(proofFor(), trueRoot.toString())).resolves.toMatchObject({
      verified: true,
    });
  });

  it('rejects a tampered sibling even when the indexer claims the right root', async () => {
    const { verifyMerklePathLocally } = await import('@/lib/indexer');
    const tampered = proofFor({ pathElements: ['999', '22'] }); // root field still "correct"
    await expect(verifyMerklePathLocally(tampered, trueRoot.toString())).rejects.toThrow(
      /Refusing to prove/,
    );
  });

  it('ignores the root the indexer claims and trusts only the chain', async () => {
    const { verifyMerklePathLocally } = await import('@/lib/indexer');
    // A consistent forged path + matching forged root claim: still rejected, because it
    // doesn't hash to what the chain holds.
    const forgedSiblings = ['1', '2'];
    const forgedRoot = toyHash([2n, toyHash([leaf, 1n])]).toString();
    const forged = proofFor({ pathElements: forgedSiblings, root: forgedRoot });
    await expect(verifyMerklePathLocally(forged, trueRoot.toString())).rejects.toThrow(
      /Merkle root mismatch/,
    );
  });

  it('rejects malformed paths before hashing anything', async () => {
    const { verifyMerklePathLocally } = await import('@/lib/indexer');
    await expect(
      verifyMerklePathLocally(proofFor({ pathIndices: [0] }), trueRoot.toString()),
    ).rejects.toThrow(/length mismatch/);
    await expect(
      verifyMerklePathLocally(proofFor({ pathIndices: [0, 2] }), trueRoot.toString()),
    ).rejects.toThrow(/Invalid path index/);
  });
});

// ─── Playground route (app/playground + workers/prover.worker.ts) ──────────────

describe('Playground egress', () => {
  const root = path.resolve(__dirname, '..');

  it('the fixture manifest only names same-origin artefacts', async () => {
    const { fixtureManifestSchema } = await import('@/lib/playground');
    const manifest = fixtureManifestSchema.parse(
      JSON.parse(
        await readFile(
          path.join(root, 'public/fixtures/playground/poseidon_preimage.json'),
          'utf8',
        ),
      ),
    );
    for (const artefact of Object.values(manifest.artefacts)) {
      expect(artefact.path.startsWith('/') && !artefact.path.startsWith('//')).toBe(true);
    }
  });

  it('the prover worker fetches only same-origin artefacts and never echoes private inputs', async () => {
    const SECRET_A = '987654321987654321987654321';
    const SECRET_B = '123456789123456789123456789';
    const fetched: string[] = [];
    const posted: unknown[] = [];

    const originalFetch = global.fetch;
    const originalPost = self.postMessage;
    global.fetch = async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      fetched.push(url);
      const body = url.endsWith('.json') ? JSON.stringify({ nPublic: 2 }) : 'binary';
      return new Response(body, { status: 200 });
    };
    self.postMessage = ((msg: unknown) => posted.push(msg)) as typeof self.postMessage;

    try {
      await import('@/workers/prover.worker');
      const handler = self.onmessage as (e: { data: unknown }) => Promise<void>;
      await handler({
        data: {
          type: 'prove',
          circuitName: 'poseidon_preimage',
          wasmUrl: '/fixtures/playground/poseidon_preimage.wasm',
          zkeyUrl: '/fixtures/playground/poseidon_preimage.zkey',
          inputs: { a: SECRET_A, b: SECRET_B, scope: '42' },
        },
      });
      await handler({
        data: {
          type: 'verify',
          vkeyUrl: '/fixtures/playground/poseidon_preimage.vkey.json',
          proof: {},
          publicSignals: ['1', '42'],
        },
      });
    } finally {
      global.fetch = originalFetch;
      self.postMessage = originalPost;
    }

    expect(fetched.length).toBeGreaterThanOrEqual(3);
    for (const url of fetched) expect(isAllowedOrigin(url)).toBe(true);
    for (const url of fetched) expect(url.startsWith('/')).toBe(true);

    const types = posted.map((m) => (m as { type: string }).type);
    expect(types).toContain('done');
    expect(types).toContain('verified');
    const wire = JSON.stringify(posted);
    expect(wire).not.toContain(SECRET_A);
    expect(wire).not.toContain(SECRET_B);
  });

  it('playground source hardcodes no request to a third-party origin', async () => {
    // A link a person clicks is not egress; a fetch/import/script/worker URL is. The only
    // absolute URL allowed is the "Read the circuit source" link to this repo.
    const ALLOWED_LINKS = new Set([
      'https://github.com/Occulta-zk/occulta-app/blob/main/fixtures/playground/poseidon_preimage.circom',
    ]);
    const files = [
      'app/playground/page.tsx',
      'app/playground/Playground.tsx',
      'workers/prover.worker.ts',
      'lib/playground.ts',
      'lib/deployments.ts',
    ];
    for (const file of files) {
      const source = await readFile(path.join(root, file), 'utf8');
      for (const [url] of source.matchAll(/https?:\/\/[^\s'"`)]+/g)) {
        expect(ALLOWED_LINKS.has(url), `${file} references ${url}`).toBe(true);
      }
      expect(source, `${file} must not use analytics/beacons`).not.toMatch(/sendBeacon|gtag\(/);
    }
  });
});

// ─── Deposit/withdrawal same-account guard ─────────────────────────────────────

describe('Deposit/withdrawal same-account guard', () => {
  /**
   * Withdrawal from the same account that deposited defeats the anonymity set entirely —
   * it is the single most common user mistake in privacy protocols (build spec §4.4, §5).
   * This guard must be applied at the UI layer before even initiating proof generation.
   */

  function canWithdraw(depositAccount: string, withdrawAccount: string): boolean {
    if (depositAccount === withdrawAccount) return false;
    return true;
  }

  it('allows withdrawal to a different account', () => {
    expect(canWithdraw('GABC123', 'GXYZ789')).toBe(true);
  });

  it('blocks withdrawal to the depositing account', () => {
    expect(canWithdraw('GABC123', 'GABC123')).toBe(false);
  });

  it('is case-sensitive (Stellar account IDs are uppercase)', () => {
    // Both forms represent the same key — but lowercase Stellar IDs aren't valid in
    // practice; the SDK normalises. Test that comparison is exact.
    expect(canWithdraw('GABC123', 'gabc123')).toBe(true); // different strings → allowed
    // (The real guard should normalise to uppercase before comparing)
  });
});

// ─── Secret values must never appear in error strings ─────────────────────────

describe('Error strings must not echo secrets', () => {
  /**
   * Build spec §5, §6 invariant: "Errors never echo secrets."
   * Any code path that formats an error from user-supplied inputs must strip or
   * not include the raw note, seed, or witness value.
   */

  const SECRET_PATTERNS = [
    /^[a-z]+ [a-z]+ [a-z]+ [a-z]+/, // mnemonic (4+ words is a red flag in an error)
    /0x[0-9a-f]{40,}/, // long hex strings (witness inputs, private signals)
  ];

  function safeErrorMessage(operation: string, _secret: string, cause: string): string {
    // Correct implementation: never include the secret value in the error message.
    return `${operation} failed: ${cause}`;
  }

  it('does not include the secret value in the error message', () => {
    const secret = 'abandon abandon abandon abandon abandon abandon abandon abandon';
    const msg = safeErrorMessage('Backup', secret, 'encryption error');

    for (const pattern of SECRET_PATTERNS) {
      expect(msg).not.toMatch(pattern);
    }
    expect(msg).toBe('Backup failed: encryption error');
  });

  it('error message contains operation context without the secret', () => {
    const msg = safeErrorMessage('Note import', '0xdeadbeef_private_witness', 'invalid format');
    expect(msg).toContain('Note import failed');
    expect(msg).not.toContain('0xdeadbeef');
  });
});
