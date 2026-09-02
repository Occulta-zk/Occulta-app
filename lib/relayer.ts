/**
 * Typed relayer client (build spec §4.5).
 *
 * Security invariants enforced here:
 *   - Relayer fee and address are ALWAYS surfaced to the user before submission.
 *     A call to `submit()` without calling `getQuote()` first throws.
 *   - Nothing is submitted silently (build spec §4.5, §5).
 *   - The user may choose their own relayer endpoint (never forced to use one operator).
 */

import type { SnarkjsProof } from './occulta';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * What this app POSTs to a relayer: a proof plus the circuit metadata the relayer needs to
 * pick the right verification key. This is the relayer's request-body shape, not an
 * @occulta/core type — `proof`/`publicSignals` come straight from the SDK's `ProveResult`
 * (see lib/occulta.ts's `prove`), `circuitName` is added by this app.
 */
export interface ProofBundle {
  proof: SnarkjsProof;
  publicSignals: string[];
  /** Circuit name, e.g. "withdraw_v1" — tells the relayer which registered VK to use. */
  circuitName: string;
}

export interface RelayerConfig {
  /** Base URL of the relayer, e.g. "http://localhost:3002". */
  url: string;
  /** Human-readable label for UI display ("operated by…"). */
  label: string;
}

export interface RelayerQuote {
  /** Relayer's Stellar account ID (shown to user before submission). */
  relayerAddress: string;
  /** Fee in stroops. */
  feeStroops: bigint;
  /** Fee as a human-readable string, e.g. "0.1 XLM". */
  feeFormatted: string;
  /** Quote validity deadline (Unix timestamp in ms). */
  validUntilMs: number;
  /** Opaque token the relayer needs to match this quote to the submission. */
  quoteToken: string;
}

export interface SubmitResult {
  /** Stellar transaction hash. */
  txHash: string;
  /** Ledger number where the transaction landed. */
  ledger: number;
}

export interface SubmitRequest {
  proof: ProofBundle;
  /** Quote token from `getQuote()` — required. */
  quoteToken: string;
  /** Recipient Stellar account ID. */
  recipient: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_RELAYER: RelayerConfig = {
  url: process.env.NEXT_PUBLIC_RELAYER_URL ?? 'http://localhost:3002',
  label: 'default (operated by the Occulta project team — see the threat model)',
};

// ─── Relayer client class ─────────────────────────────────────────────────────

export class RelayerClient {
  private readonly baseUrl: string;
  readonly config: RelayerConfig;

  /** A quote must be fetched before submission; this holds the last fetched quote. */
  private lastQuote: RelayerQuote | null = null;

  constructor(config: RelayerConfig = DEFAULT_RELAYER) {
    this.config = config;
    this.baseUrl = config.url.replace(/\/$/, '');
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...options,
    });
    if (!response.ok) {
      throw new Error(`Relayer request failed: ${url} returned HTTP ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  /**
   * Fetches a fee quote from the relayer. The UI MUST show `quote.feeFormatted` and
   * `quote.relayerAddress` to the user before calling `submit()`.
   */
  async getQuote(recipientAddress: string): Promise<RelayerQuote> {
    const raw = await this.fetch<{
      relayer_address: string;
      fee_stroops: string;
      fee_formatted: string;
      valid_until_ms: number;
      quote_token: string;
    }>('/quote', {
      method: 'POST',
      body: JSON.stringify({ recipient: recipientAddress }),
    });

    this.lastQuote = {
      relayerAddress: raw.relayer_address,
      feeStroops: BigInt(raw.fee_stroops),
      feeFormatted: raw.fee_formatted,
      validUntilMs: raw.valid_until_ms,
      quoteToken: raw.quote_token,
    };
    return this.lastQuote;
  }

  /**
   * Submits a proof to the relayer for on-chain execution.
   *
   * REQUIRES `getQuote()` to have been called first — this enforces that the UI
   * showed the fee and relayer address before submission. Throws otherwise.
   *
   * Also validates the quote has not expired.
   */
  async submit(request: SubmitRequest): Promise<SubmitResult> {
    if (!this.lastQuote) {
      throw new Error(
        'A relayer quote must be fetched and shown to the user before submitting. ' +
          'Call getQuote() first.',
      );
    }

    if (Date.now() > this.lastQuote.validUntilMs) {
      this.lastQuote = null;
      throw new Error('Relayer quote has expired. Please fetch a new quote.');
    }

    const raw = await this.fetch<{ tx_hash: string; ledger: number }>('/submit', {
      method: 'POST',
      body: JSON.stringify({
        proof: request.proof,
        quote_token: request.quoteToken,
        recipient: request.recipient,
      }),
    });

    this.lastQuote = null; // quote is single-use
    return { txHash: raw.tx_hash, ledger: raw.ledger };
  }

  /** Returns the most recently fetched quote, if still valid. */
  getLastQuote(): RelayerQuote | null {
    if (!this.lastQuote) return null;
    if (Date.now() > this.lastQuote.validUntilMs) {
      this.lastQuote = null;
      return null;
    }
    return this.lastQuote;
  }
}
