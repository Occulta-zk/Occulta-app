'use client';

/**
 * WalletConnect — connects a Freighter or passkey smart wallet (build spec §4.4).
 *
 * Security requirements this component fulfils:
 *   - Never renders a field that could accept a secret key or seed phrase. Connection is
 *     always delegated to the wallet extension via lib/wallet.ts — this component never
 *     sees key material (SECURITY.md #7).
 *   - The connected account address is always shown before any transaction is signed
 *     elsewhere in the app (build spec §4.4).
 *   - Errors from the wallet layer are shown as-is; lib/wallet.ts already guarantees they
 *     never contain secret material (SECURITY.md #5).
 */

import { useCallback, useState } from 'react';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import type { ConnectedWallet, WalletType } from '@/lib/wallet';
import { connectWallet } from '@/lib/wallet';
import styles from './WalletConnect.module.css';

export interface WalletConnectProps {
  /** The currently connected wallet, or `null` if none. Lifted to the parent so other
   * components (deposit/withdraw flows) can read the connected address. */
  wallet: ConnectedWallet | null;
  onConnect: (wallet: ConnectedWallet) => void;
  onDisconnect: () => void;
}

const WALLET_OPTIONS: ReadonlyArray<{
  type: WalletType;
  icon: string;
  label: string;
  badge?: string;
}> = [
  { type: 'freighter', icon: '🦊', label: 'Freighter' },
  { type: 'passkey', icon: '🔑', label: 'Passkey smart wallet', badge: 'Coming soon' },
];

export function WalletConnect({ wallet, onConnect, onDisconnect }: WalletConnectProps) {
  const [connecting, setConnecting] = useState<WalletType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = useCallback(
    async (type: WalletType) => {
      setError(null);
      setConnecting(type);
      try {
        const connected = await connectWallet(type);
        onConnect(connected);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect wallet.');
      } finally {
        setConnecting(null);
      }
    },
    [onConnect],
  );

  if (wallet) {
    return (
      <div className={styles.container}>
        <div className={styles.connected}>
          <span aria-hidden="true">{wallet.type === 'freighter' ? '🦊' : '🔑'}</span>
          <div className={styles.connectedInfo}>
            <p className={styles.connectedLabel}>Connected — {wallet.displayName}</p>
            <p className={styles.connectedAddress}>{wallet.address}</p>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              wallet.disconnect();
              onDisconnect();
            }}
          >
            Disconnect
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <p className={styles.title}>Connect a wallet</p>

      <div className={styles.options}>
        {WALLET_OPTIONS.map((opt) => (
          <button
            key={opt.type}
            type="button"
            className={styles.option}
            disabled={connecting !== null || Boolean(opt.badge)}
            onClick={() => handleConnect(opt.type)}
          >
            <span className={styles.optionIcon} aria-hidden="true">
              {opt.icon}
            </span>
            <span className={styles.optionLabel}>
              {connecting === opt.type ? `Connecting to ${opt.label}…` : opt.label}
            </span>
            {opt.badge && <span className={styles.optionBadge}>{opt.badge}</span>}
          </button>
        ))}
      </div>

      {error && (
        <Banner variant="danger" live>
          {error}
        </Banner>
      )}

      <p className={styles.disclaimer}>
        Occulta never asks for a secret key or seed phrase to connect a wallet. Any page that does
        is not this app — see <a href="/docs/threat-model">the threat model</a>.
      </p>
    </div>
  );
}
