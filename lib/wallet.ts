/**
 * Wallet abstraction — Freighter and passkey smart wallets (build spec §4.4).
 *
 * Security invariants enforced here:
 *   - NEVER requests a secret key, seed phrase, or mnemonic. Any code path that
 *     prompts for a secret key is indistinguishable from a phishing page (SECURITY.md #7).
 *   - Deposit and withdrawal from the same account are detected and refused at this
 *     layer (build spec §4.4, §5, SECURITY.md #8).
 *   - The connected account is displayed to the user before any transaction is signed.
 *
 * @occulta/core is not imported here — wallet signing is pure Stellar, no ZK.
 *
 * `@stellar/freighter-api@6.0.1` is installed (build spec §4.4 M2). Its API differs
 * substantially from older majors: every call returns `{ ...result, error? }` — errors
 * are data, not thrown exceptions — and the address getter is `getAddress()`, not
 * `getPublicKey()`. The shapes below are verified live 2026-09-02 against the installed
 * package's own `src/*.ts` (getAddress.ts, signTransaction.ts, isAllowed.ts,
 * requestAccess.ts, isConnected.ts) — do not trust older Freighter docs/examples.
 *
 * Passkey smart wallets are not implemented — the Stellar smart-wallet wallet-kit API
 * needs its own VERIFY pass before this file assumes a shape for it (build spec §4.4).
 */

import * as freighter from '@stellar/freighter-api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type WalletType = 'freighter' | 'passkey';

export interface ConnectedWallet {
  type: WalletType;
  /** Stellar account ID (G… address). */
  address: string;
  /** Human-readable display name, e.g. "Freighter" or "Passkey …ab12". */
  displayName: string;
  /**
   * Signs and submits a Stellar transaction XDR.
   * Returns the submitted transaction hash.
   * Never called with a plaintext key — the wallet extension handles signing.
   */
  signAndSubmit(xdr: string): Promise<{ txHash: string }>;
  /** Signs a transaction XDR without submitting (for relayer flow). */
  sign(xdr: string): Promise<{ signedXdr: string }>;
  /** Disconnect this wallet — clears the session. */
  disconnect(): void;
}

// ─── Deposit / withdrawal guard ────────────────────────────────────────────────

/**
 * The single-account privacy-defeat check (build spec §4.4, SECURITY.md #8).
 *
 * If the withdrawal recipient is the same Stellar account that made the deposit,
 * the anonymity set provides zero protection — the transaction graph trivially links
 * deposit to withdrawal. Reject this before proof generation begins.
 *
 * Normalises to uppercase to handle any case variations from different SDK versions.
 */
export function assertDifferentAccounts(depositAccount: string, withdrawAccount: string): void {
  const a = depositAccount.trim().toUpperCase();
  const b = withdrawAccount.trim().toUpperCase();
  if (a === b) {
    throw new Error(
      'Withdrawal account must be different from the deposit account. ' +
        'Withdrawing to the same account defeats the anonymity set entirely — ' +
        'anyone watching the chain can trivially link your deposit and withdrawal.',
    );
  }
}

// ─── Freighter wallet ─────────────────────────────────────────────────────────

async function connectFreighter(): Promise<ConnectedWallet> {
  const connected = await freighter.isConnected();
  if (connected.error || !connected.isConnected) {
    throw new Error(
      'Freighter browser extension is not installed. ' +
        'Install Freighter from https://freighter.app and refresh the page.',
    );
  }

  const allowed = await freighter.isAllowed();
  if (allowed.error) {
    throw new Error(`Freighter: ${allowed.error.message}`);
  }
  if (!allowed.isAllowed) {
    const access = await freighter.requestAccess();
    if (access.error) {
      throw new Error(`Freighter access request was rejected: ${access.error.message}`);
    }
  }

  const addressResult = await freighter.getAddress();
  if (addressResult.error) {
    throw new Error(`Freighter: ${addressResult.error.message}`);
  }
  const { address } = addressResult;
  if (!address) {
    throw new Error('Freighter did not return an account address. Is the extension unlocked?');
  }

  const networkPassphrase =
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015';

  async function signWithFreighter(xdr: string): Promise<string> {
    const result = await freighter.signTransaction(xdr, { networkPassphrase, address });
    if (result.error) {
      throw new Error(`Freighter declined to sign: ${result.error.message}`);
    }
    return result.signedTxXdr;
  }

  return {
    type: 'freighter',
    address,
    displayName: `Freighter (${address.slice(0, 6)}…${address.slice(-4)})`,
    async signAndSubmit(xdr: string): Promise<{ txHash: string }> {
      const signedXdr = await signWithFreighter(xdr);
      // Minimal broadcast for wallet-connectivity testing. The actual withdrawal flow
      // (build spec §4.5) must go through @occulta/core's `submit()` (via lib/occulta.ts)
      // instead — it also runs simulate → restore-list → assemble and the same-account
      // deposit/withdraw guard, none of which this shortcut performs.
      const rpcUrl =
        process.env.NEXT_PUBLIC_DEFAULT_SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sendTransaction',
          params: { transaction: signedXdr },
        }),
      });
      const result = (await response.json()) as {
        result?: { hash: string };
        error?: { message: string };
      };
      if (result.error) throw new Error(`Transaction failed: ${result.error.message}`);
      return { txHash: result.result?.hash ?? '' };
    },
    async sign(xdr: string): Promise<{ signedXdr: string }> {
      return { signedXdr: await signWithFreighter(xdr) };
    },
    disconnect() {
      // Freighter doesn't have an explicit disconnect API; we clear our local state.
    },
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Connects a wallet. Returns a `ConnectedWallet` that this app's components use.
 *
 * Never prompts for a secret key or seed phrase — the wallet extension handles all
 * key operations (SECURITY.md #7).
 */
export async function connectWallet(type: WalletType): Promise<ConnectedWallet> {
  switch (type) {
    case 'freighter':
      return connectFreighter();
    case 'passkey':
      throw new Error(
        'Passkey smart wallets are not yet supported. ' +
          'This will be implemented when the Stellar passkey wallet API is stable. ' +
          'See https://stellar.org/learn/crypto-smart-contract-wallets for context.',
      );
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown wallet type: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Detects whether the Freighter extension is installed (but not necessarily unlocked).
 * `@stellar/freighter-api` is always resolvable (it's a bundled library, not the
 * extension itself) — the only real signal is its own `isConnected()` probe.
 */
export async function isFreighterInstalled(): Promise<boolean> {
  try {
    const result = await freighter.isConnected();
    return !result.error && result.isConnected;
  } catch {
    return false;
  }
}
