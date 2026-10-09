/**
 * Thin wrapper over @occulta/core (build spec §3, §12).
 *
 * This module is the ONLY place in occulta-app that imports from @occulta/core. All
 * cryptographic operations, Merkle constructions, witness building, and proof preparation
 * are done in the SDK — never here. This file's job is to:
 *   1. Re-export the SDK's real types and functions this app needs, under their real names.
 *   2. Gate access behind `loadCore()`, which throws a clear, actionable error if the SDK
 *      isn't installed rather than letting an unresolved import crash the build.
 *   3. Be the single file a reviewer checks to confirm "no crypto here" (SECURITY.md #2) —
 *      and the single file to check that this app's calls match the SDK's real API surface,
 *      never an invented one (build spec §0 rule 2).
 *
 * @occulta/core is NOT YET an installable dependency of this app — see
 * types/occulta-core.d.ts for why, and README.md Status for the current blocker. Every
 * function below is typed against that file's mirror of the real, verified SDK surface
 * (occulta-sdk@7e32138, verified 2026-09-02) and will fail loudly at runtime, not silently,
 * until the dependency lands: `loadCore()` throws with instructions rather than returning a
 * stub. Caveat, verified against the Next 16.3.4 Turbopack build: the bundler refuses the
 * unresolvable `import('@occulta/core')` below, so `next build` FAILS if any route imports
 * this file — directly, or via lib/indexer.ts or the components/proving barrel (through
 * AnonymitySetBadge). Today no route does; app/playground imports ProgressPanel directly for
 * that reason. Tests resolve the specifier to test/stubs/occulta-core.ts instead.
 *
 * NEVER import circomlibjs, ffjavascript, snarkjs, or any ZK/crypto library directly in this
 * file or anywhere else in occulta-app outside workers/prover.worker.ts (which calls snarkjs
 * only to match @occulta/core's own verified call shape — see that file's header). Those
 * belong in occulta-sdk.
 */

import type {
  MerkleProof,
  Note,
  NoteStore,
  NoteWithLeaf,
  OccultaConfig,
  OccultaPoseidon,
  OnProgress,
  ProveArtifacts,
  ProveResult,
  Signer,
  SnarkjsProof,
  SnarkjsVKey,
  SubmitResult,
  TransactionRequest,
  WitnessInput,
} from '@occulta/core';

// ─── Re-exported types (see types/occulta-core.d.ts for the verified source) ──
export type {
  MerkleProof,
  Note,
  NoteStore,
  NoteWithLeaf,
  OccultaConfig,
  OccultaPoseidon,
  OnProgress,
  ProveArtifacts,
  ProveResult,
  Signer,
  SnarkjsProof,
  SnarkjsVKey,
  SubmitResult,
  TransactionRequest,
  WitnessInput,
};

// ─── SDK availability guard ───────────────────────────────────────────────────

let core: Promise<typeof import('@occulta/core')> | null = null;

/**
 * Loads @occulta/core, caching the promise so repeated calls don't re-import. Throws a
 * clear, actionable error — never a stub or a silent no-op — if the package can't be
 * resolved, so callers fail loudly instead of proceeding with fake data.
 */
function loadCore(): Promise<typeof import('@occulta/core')> {
  core ??= import('@occulta/core').catch((cause: unknown) => {
    core = null; // allow retry once the dependency is actually installed
    throw new Error(
      '@occulta/core is not installed. This app requires the Occulta SDK (occulta-sdk ' +
        'repo, package @occulta/core) to be published and added to package.json before ' +
        'proving or note management can work — see README.md Status.',
      { cause },
    );
  });
  return core;
}

// ─── Poseidon (cached — building the WASM instance is the expensive part) ─────

let poseidon: Promise<OccultaPoseidon> | null = null;

/** Returns the shared OccultaPoseidon instance, building it on first call. */
export async function getPoseidon(): Promise<OccultaPoseidon> {
  poseidon ??= loadCore().then((sdk) => sdk.buildOccultaPoseidon());
  return poseidon;
}

// ─── Notes (mirrors @occulta/core's notes.ts) ──────────────────────────────────

/** Derives a deterministic note from a 64-byte BIP-39 seed and an index. */
export async function deriveNote(seed: Uint8Array, index: number, amount: bigint): Promise<Note> {
  const sdk = await loadCore();
  return sdk.deriveNote(seed, index, amount);
}

/** Commitment = Poseidon(secret, nullifier, amount) — what the contract stores on-chain. */
export async function commitment(note: Note): Promise<bigint> {
  const [sdk, p] = await Promise.all([loadCore(), getPoseidon()]);
  return sdk.commitment(note, p);
}

/** NullifierHash = Poseidon(nullifier, externalNullifier) — revealed on spend. */
export async function nullifierHash(note: Note, externalNullifier: bigint): Promise<bigint> {
  const [sdk, p] = await Promise.all([loadCore(), getPoseidon()]);
  return sdk.nullifierHash(note, externalNullifier, p);
}

/** Creates a fresh, empty NoteStore. Notes live in memory only — see NoteStore's own docs. */
export async function createNoteStore(): Promise<NoteStore> {
  const sdk = await loadCore();
  return new sdk.NoteStore();
}

/**
 * Restores a NoteStore from an encrypted backup blob produced by `NoteStore.exportBackup`
 * (build spec §4.3 — force a backup before the first deposit). Throws on wrong passphrase
 * or a corrupted blob.
 */
export async function importNoteStoreBackup(
  blob: Uint8Array,
  passphrase: string,
): Promise<NoteStore> {
  const sdk = await loadCore();
  return sdk.NoteStore.importBackup(blob, passphrase);
}

// ─── Merkle mirror (mirrors @occulta/core's merkle.ts) ─────────────────────────

/**
 * Creates a client-side Merkle mirror at the given depth (must match the deployed circuit's
 * depth — read it from `deployments/testnet.json`, never hardcode it).
 */
export async function createMerkleMirror(depth: number): Promise<{
  insert(commitmentValue: bigint): number;
  path(leafIndex: number): MerkleProof;
  readonly root: bigint;
  readonly anonymitySet: number;
  readonly depth: number;
}> {
  const [sdk, p] = await Promise.all([loadCore(), getPoseidon()]);
  return new sdk.MerkleMirror(depth, p);
}

/**
 * Recomputes a Merkle root from a leaf and its path (siblings + direction bits), per the
 * algorithm documented on `@occulta/core`'s `MerkleProof` type: at each level, if
 * `indices[i] === 0` the current node is the left child (`hash(node, sibling)`); otherwise
 * it's the right child (`hash(sibling, node)`).
 *
 * This is the local-verification step build spec §4.5 requires: recompute the root from a
 * path an indexer returned and compare it to a root fetched from the chain — BEFORE the
 * path is used for proving. A malicious or buggy indexer that returns a tampered path (right
 * root, wrong siblings, or vice versa) cannot poison a proof, because this function computes
 * the root from the path itself rather than trusting the indexer's claimed root.
 */
export async function recomputeMerkleRoot(
  leaf: bigint,
  siblings: readonly bigint[],
  indices: readonly number[],
): Promise<bigint> {
  if (siblings.length !== indices.length) {
    throw new Error(
      `recomputeMerkleRoot: siblings (${siblings.length}) and indices (${indices.length}) ` +
        'length mismatch.',
    );
  }
  const p = await getPoseidon();
  let node = leaf;
  for (let i = 0; i < siblings.length; i++) {
    const sibling = siblings[i]!;
    const isRight = indices[i] === 1;
    node = isRight ? p.hash([sibling, node]) : p.hash([node, sibling]);
  }
  return node;
}

// ─── Proving and submission (mirrors @occulta/core's proving.ts) ──────────────

/** Generates a Groth16 proof. `onProgress` is required for anything but a trivial circuit —
 * see workers/prover.worker.ts, which is where this actually runs (never the main thread). */
export async function prove(
  artifacts: ProveArtifacts,
  input: WitnessInput,
  onProgress?: OnProgress,
): Promise<ProveResult> {
  const sdk = await loadCore();
  return sdk.prove(artifacts, input, onProgress);
}

/** Verifies a Groth16 proof locally. Always call before submitting (build spec §7.2, SDK's
 * own `submit` also does this when given vkey+proof+publicSignals). */
export async function verifyLocal(
  vkey: SnarkjsVKey,
  publicSignals: string[],
  proof: SnarkjsProof,
): Promise<boolean> {
  const sdk = await loadCore();
  return sdk.verifyLocal(vkey, publicSignals, proof);
}

/** Simulation-first Stellar transaction submission — see @occulta/core's `submit` docs for
 * the full flow (same-account guard, local verification, simulate/assemble/sign/poll). */
export async function submit(
  cfg: OccultaConfig,
  request: TransactionRequest,
  signer: Signer,
  options?: {
    readonly vkey?: SnarkjsVKey;
    readonly proof?: SnarkjsProof;
    readonly publicSignals?: string[];
    readonly onProgress?: OnProgress;
  },
): Promise<SubmitResult> {
  const sdk = await loadCore();
  return sdk.submit(cfg, request, signer, options);
}

// ─── SDK version check ────────────────────────────────────────────────────────

/** Returns the @occulta/core version string, or null if not installed. Never throws. */
export async function getSdkVersion(): Promise<string | null> {
  try {
    const sdk = await loadCore();
    return sdk.OCCULTA_CORE_SCAFFOLD_VERSION;
  } catch {
    return null;
  }
}
