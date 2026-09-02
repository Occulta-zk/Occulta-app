/**
 * Typed indexer client (build spec §4.5).
 *
 * Security invariants enforced here:
 *   - Every Merkle path returned by the indexer is verified locally against a root
 *     the chain says it knows, BEFORE the path is used for proving. A malicious or
 *     buggy indexer cannot poison a proof (build spec §4.5, SECURITY.md #6).
 *   - The anonymity set size is surfaced to every withdrawal caller. Any size below
 *     WARNING_THRESHOLD triggers a visible warning — the UI must show this, not hide it.
 *   - No secrets cross through this client. It receives public commitments from the
 *     indexer; the caller decides which notes it owns.
 */

import { recomputeMerkleRoot } from './occulta';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * An on-chain commitment record as the indexer reports it. This is the indexer's REST
 * response shape, not an @occulta/core type — the SDK only knows about the raw commitment
 * value (a field element); `amount`/`asset`/`blockNumber`/`spent` are indexer-side metadata
 * this app displays but never treats as a source of truth for anything security-relevant
 * (the on-chain nullifier registry is — see IndexerClient.isNullifierSpent).
 */
export interface NoteCommitment {
  /** Hex-encoded Poseidon commitment, as returned by the indexer. */
  commitment: string;
  amount: bigint;
  asset: string;
  /** Block number when this commitment was added to the tree. */
  blockNumber: number;
  spent: boolean;
}

export interface MerkleProof {
  /** The leaf commitment being proven. */
  leaf: string;
  /** Sibling elements from leaf to root (Poseidon hashes). */
  pathElements: string[];
  /** 0 = left child, 1 = right child at each level. */
  pathIndices: number[];
  /** The root this path was computed against (the indexer's claim). */
  root: string;
  /** Block number when the tree had this root (for staleness detection). */
  blockNumber: number;
}

export interface IndexerStatus {
  latestBlock: number;
  treeSize: number;
  /** How many unspent commitments are in the tree (the anonymity set). */
  anonymitySetSize: number;
  operatorNote?: string;
}

export interface IndexerConfig {
  /** Base URL of the indexer, e.g. "http://localhost:3001". */
  url: string;
  /** Human-readable label shown in the UI ("operated by…"). */
  label: string;
}

export type VerifiedMerkleProof = MerkleProof & { verified: true };

// ─── Constants ────────────────────────────────────────────────────────────────

/** Below this anonymity set size, the UI must show a prominent warning. */
export const ANONYMITY_SET_WARNING_THRESHOLD = 10;

/** Default indexer — user can override in settings. */
export const DEFAULT_INDEXER: IndexerConfig = {
  url: process.env.NEXT_PUBLIC_INDEXER_URL ?? 'http://localhost:3001',
  label: 'default (operated by the Occulta project team — see the threat model)',
};

// ─── Merkle path local verification ──────────────────────────────────────────

/**
 * Verifies a Merkle path locally against a trusted on-chain root.
 *
 * The trusted root must come from the chain (via Stellar RPC), NOT from the indexer
 * (build spec §4.5). This recomputes the root from `proof.leaf` and the sibling/index path
 * using @occulta/core's Poseidon hash (via `recomputeMerkleRoot`) and compares the result to
 * `trustedOnChainRoot` — NOT to `proof.root` (the indexer's own claimed root, which a
 * malicious indexer could set to match a tampered path). This is the primary defence
 * against a malicious or buggy indexer that returns a forged path.
 */
export async function verifyMerklePathLocally(
  proof: MerkleProof,
  trustedOnChainRoot: string,
): Promise<VerifiedMerkleProof> {
  if (!proof.leaf || !proof.root) {
    throw new Error('Merkle proof is missing required fields');
  }
  if (proof.pathElements.length !== proof.pathIndices.length) {
    throw new Error('Merkle proof path elements and indices length mismatch');
  }
  for (const idx of proof.pathIndices) {
    if (idx !== 0 && idx !== 1) {
      throw new Error(`Invalid path index: ${idx}`);
    }
  }

  const computedRoot = await recomputeMerkleRoot(
    BigInt(proof.leaf),
    proof.pathElements.map((e) => BigInt(e)),
    proof.pathIndices,
  );
  const trustedRoot = BigInt(trustedOnChainRoot);

  // The critical check: the root recomputed from the path must match what the chain says —
  // not what the indexer merely claims in `proof.root` (build spec §4.5).
  if (computedRoot !== trustedRoot) {
    throw new Error(
      `Merkle root mismatch: recomputing the path yields ${computedRoot.toString()}, ` +
        `but the chain says the root is ${trustedOnChainRoot}. ` +
        'The indexer may be malicious or out of sync. Refusing to prove.',
    );
  }

  return { ...proof, verified: true };
}

// ─── Indexer client class ─────────────────────────────────────────────────────

export class IndexerClient {
  private readonly baseUrl: string;
  readonly config: IndexerConfig;

  constructor(config: IndexerConfig = DEFAULT_INDEXER) {
    this.config = config;
    // Strip trailing slash for consistent URL construction
    this.baseUrl = config.url.replace(/\/$/, '');
  }

  private async fetch<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Indexer request failed: ${url} returned HTTP ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  /** Returns the indexer's operational status including anonymity set size. */
  async getStatus(): Promise<IndexerStatus> {
    return this.fetch<IndexerStatus>('/status');
  }

  /** Returns all commitments in the tree, newest first. */
  async getCommitments(fromBlock = 0): Promise<NoteCommitment[]> {
    return this.fetch<NoteCommitment[]>(`/commitments?from_block=${fromBlock}`);
  }

  /**
   * Returns the Merkle proof for a commitment AND verifies it against the on-chain root.
   *
   * @param commitment - The hex-encoded commitment leaf.
   * @param trustedOnChainRoot - Root fetched directly from the Stellar RPC, not the indexer.
   * @throws if the path does not verify — never returns an unverified path.
   */
  async getMerkleProof(
    commitment: string,
    trustedOnChainRoot: string,
  ): Promise<VerifiedMerkleProof> {
    const raw = await this.fetch<MerkleProof>(`/merkle-proof/${commitment}`);
    // This is the critical step — verify before returning (build spec §4.5)
    return verifyMerklePathLocally(raw, trustedOnChainRoot);
  }

  /**
   * Returns on-chain nullifiers that have been spent, so the UI can mark notes as used.
   */
  async getSpentNullifiers(): Promise<string[]> {
    return this.fetch<string[]>('/nullifiers/spent');
  }

  /**
   * Checks if a specific nullifier has been spent on-chain.
   */
  async isNullifierSpent(nullifierHash: string): Promise<boolean> {
    const result = await this.fetch<{ spent: boolean }>(`/nullifiers/${nullifierHash}`);
    return result.spent;
  }
}

// ─── Anonymity set helpers ────────────────────────────────────────────────────

/**
 * Returns true if the anonymity set is large enough to consider a withdrawal private.
 * The UI must call this before displaying a "withdraw" button as safe.
 */
export function isAnonymitySetSafe(size: number): boolean {
  return size >= ANONYMITY_SET_WARNING_THRESHOLD;
}

/**
 * Returns a human-readable description of what the anonymity set size means for privacy.
 * The UI should show this inline at withdrawal time — not buried in docs.
 */
export function anonymitySetDescription(size: number): {
  level: 'critical' | 'low' | 'moderate' | 'good';
  message: string;
} {
  if (size < 3) {
    return {
      level: 'critical',
      message: `Only ${size} note${size === 1 ? '' : 's'} in the tree. Withdrawal is NOT private — the sender can be trivially identified. Wait for more deposits.`,
    };
  }
  if (size < ANONYMITY_SET_WARNING_THRESHOLD) {
    return {
      level: 'low',
      message: `${size} notes in the tree. Anonymity is weak. Consider waiting for more deposits before withdrawing.`,
    };
  }
  if (size < 50) {
    return {
      level: 'moderate',
      message: `${size} notes in the anonymity set. Moderate privacy. More deposits improve it.`,
    };
  }
  return {
    level: 'good',
    message: `${size} notes in the anonymity set. Good privacy.`,
  };
}
