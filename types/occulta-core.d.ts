/**
 * Ambient type declaration for `@occulta/core`, which is NOT YET an installable dependency
 * of this app (build spec §12: "Do not hardcode... call the SDK" — but the SDK repo
 * (occulta-sdk) has not published this package to a registry, and its `dist/` output is
 * gitignored, so there is no dependency spec — npm, pnpm git+path, or otherwise — that
 * currently resolves it; see README.md Status). Runtime access always goes through
 * `lib/occulta.ts`'s `loadCore()`, which dynamically imports the bare specifier below and
 * throws a clear, actionable error if it can't be resolved. Note that `next build` fails if
 * any route imports lib/occulta.ts while the package is missing — see that file's header.
 *
 * This declaration exists so `lib/occulta.ts` can be typed against the REAL SDK surface
 * instead of an invented one (build spec §0 rule 2: "Never invent an API"). It is a mirror,
 * not a substitute for the real thing — every member here is transcribed from
 * occulta-sdk@7e32138's `packages/core/src/index.ts` and the modules it re-exports
 * (notes.ts, merkle.ts, poseidon.ts, proving.ts, encoding.ts), verified 2026-09-02.
 *
 * DELETE THIS FILE once `@occulta/core` becomes a real, resolvable dependency (npm publish,
 * or a `pnpm add` git+path spec once occulta-sdk ships a `prepare` build hook for
 * packages/core — see README.md Status for why the git+path route doesn't work yet) —
 * `tsc` will then check `lib/occulta.ts` against the genuine types, which is strictly
 * better than trusting this hand-maintained mirror to stay in sync.
 */

declare module '@occulta/core' {
  // ─── poseidon.ts ────────────────────────────────────────────────────────────
  export interface OccultaPoseidon {
    /** Hashes 1-16 BN254 Fr field elements. Range-checks every input. */
    hash(inputs: readonly bigint[]): bigint;
  }
  export function buildOccultaPoseidon(): Promise<OccultaPoseidon>;

  // ─── notes.ts ───────────────────────────────────────────────────────────────
  export interface Note {
    readonly secret: bigint;
    readonly nullifier: bigint;
    readonly amount: bigint;
    readonly leafIndex?: number;
  }
  export type NoteWithLeaf = Note & { readonly leafIndex: number };

  export function deriveNote(seed: Uint8Array, index: number, amount: bigint): Promise<Note>;
  export function commitment(note: Note, poseidon: OccultaPoseidon): bigint;
  export function nullifierHash(
    note: Note,
    externalNullifier: bigint,
    poseidon: OccultaPoseidon,
  ): bigint;

  export class NoteStore {
    add(note: Note): void;
    readonly notes: readonly Note[];
    scan(commitments: bigint[], poseidon: OccultaPoseidon): NoteWithLeaf[];
    exportBackup(passphrase: string): Promise<Uint8Array>;
    static importBackup(blob: Uint8Array, passphrase: string): Promise<NoteStore>;
  }

  // ─── merkle.ts ──────────────────────────────────────────────────────────────
  export interface MerkleProof {
    readonly siblings: readonly bigint[];
    readonly indices: readonly number[];
    readonly root: bigint;
  }

  export class MerkleMirror {
    constructor(depth: number, hasher: OccultaPoseidon);
    insert(commitment: bigint): number;
    path(leafIndex: number): MerkleProof;
    readonly root: bigint;
    readonly anonymitySet: number;
    readonly depth: number;
    static fromEvents(
      events: readonly { commitment: bigint; leafIndex: number }[],
      depth: number,
      hasher: OccultaPoseidon,
    ): MerkleMirror;
  }

  // ─── encoding.ts (subset `proving.ts` depends on) ──────────────────────────
  type SnarkjsG1 = readonly [string, string, string];
  type SnarkjsG2 = readonly [
    readonly [string, string],
    readonly [string, string],
    readonly [string, string],
  ];
  export interface SnarkjsProof {
    readonly protocol: string;
    readonly curve: string;
    readonly pi_a: SnarkjsG1;
    readonly pi_b: SnarkjsG2;
    readonly pi_c: SnarkjsG1;
  }
  export interface SnarkjsVKey {
    readonly protocol: string;
    readonly curve: string;
    readonly nPublic: number;
    readonly vk_alpha_1: SnarkjsG1;
    readonly vk_beta_2: SnarkjsG2;
    readonly vk_gamma_2: SnarkjsG2;
    readonly vk_delta_2: SnarkjsG2;
    readonly IC: readonly SnarkjsG1[];
  }

  // ─── proving.ts ─────────────────────────────────────────────────────────────
  export interface ProveArtifacts {
    readonly wasm: Uint8Array;
    readonly zkey: Uint8Array;
  }
  export type WitnessInput = Record<
    string,
    bigint | number | string | (bigint | number | string)[]
  >;
  export interface ProveResult {
    readonly proof: SnarkjsProof;
    readonly publicSignals: string[];
  }
  export type OnProgress = (step: string, progress: number) => void;

  export function prove(
    artifacts: ProveArtifacts,
    input: WitnessInput,
    onProgress?: OnProgress,
  ): Promise<ProveResult>;

  export function verifyLocal(
    vkey: SnarkjsVKey,
    publicSignals: string[],
    proof: SnarkjsProof,
  ): Promise<boolean>;

  export interface OccultaConfig {
    readonly rpcUrl: string;
    readonly networkPassphrase: string;
  }
  export interface TransactionRequest {
    readonly transactionXdr: string;
    readonly submitterAccount?: string;
    readonly knownDepositAccounts?: readonly string[];
  }
  export type Signer = (transactionXdr: string) => Promise<string>;
  export interface SubmitResult {
    readonly txHash: string;
    readonly ledger: number;
    readonly status: 'SUCCESS' | 'FAILED';
  }

  export function submit(
    cfg: OccultaConfig,
    request: TransactionRequest,
    signer: Signer,
    options?: {
      readonly vkey?: SnarkjsVKey;
      readonly proof?: SnarkjsProof;
      readonly publicSignals?: string[];
      readonly onProgress?: OnProgress;
    },
  ): Promise<SubmitResult>;

  // ─── package version ────────────────────────────────────────────────────────
  export const OCCULTA_CORE_SCAFFOLD_VERSION: string;
}
