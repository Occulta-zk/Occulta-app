'use client';

/**
 * ProgressPanel — honest, real-time feedback for the proving flow (build spec §2, §5).
 *
 * Security / UX requirements this component fulfils:
 *   - Shows what is actually happening (downloading, compiling, proving), not a spinner.
 *   - Shows elapsed time and estimated remaining time so users don't think it crashed.
 *   - Provides a cancel button at every stage.
 *   - Never shows proof data, public signals, or any witness value in the UI.
 *   - Uses an aria-live region so screen readers announce state changes.
 *   - No layout shift when state updates.
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/ProgressBar';
import styles from './ProgressPanel.module.css';

export type ProverPhase =
  'idle' | 'downloading' | 'compiling' | 'proving' | 'done' | 'error' | 'cancelled';

export interface ProgressPanelProps {
  phase: ProverPhase;
  phaseLabel?: string;
  /** 0–1, for the download progress bar */
  downloadProgress?: number;
  totalDownloadBytes?: number;
  /** Estimated total proving time in ms — used to show remaining time */
  estimatedMs?: number;
  /** Actual proving time on completion */
  provingTimeMs?: number;
  onCancel?: () => void;
  error?: string;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const PHASE_LABELS: Record<ProverPhase, string> = {
  idle: 'Waiting',
  downloading: 'Downloading proving artefacts',
  compiling: 'Preparing circuit',
  proving: 'Generating proof',
  done: 'Proof complete',
  error: 'Proof failed',
  cancelled: 'Cancelled',
};

const PHASE_ICONS: Record<ProverPhase, string> = {
  idle: '⏸',
  downloading: '⬇',
  compiling: '⚙',
  proving: '🔐',
  done: '✅',
  error: '❌',
  cancelled: '⛔',
};

export function ProgressPanel({
  phase,
  phaseLabel,
  downloadProgress = 0,
  totalDownloadBytes = 0,
  estimatedMs,
  provingTimeMs,
  onCancel,
  error,
}: ProgressPanelProps) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // Track elapsed time while an active phase is running
  useEffect(() => {
    const active = phase === 'downloading' || phase === 'compiling' || phase === 'proving';

    if (active) {
      if (!startRef.current) startRef.current = performance.now();

      const tick = () => {
        if (startRef.current) {
          setElapsedMs(Math.round(performance.now() - startRef.current));
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (phase === 'idle' || phase === 'cancelled') {
        // No setState here — `elapsedMs` is only ever rendered while `phase` is
        // downloading/compiling/proving, so a stale value sitting in state between runs is
        // never shown. Resetting the ref is enough: the next active phase starts its own
        // clock from `performance.now()` (see the `active` branch above).
        startRef.current = null;
      }
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [phase]);

  if (phase === 'idle') return null;

  const showDownloadBar = phase === 'downloading' && downloadProgress > 0;
  const showIndeterminate = (phase === 'compiling' || phase === 'proving') && !showDownloadBar;
  const showCancel =
    onCancel && (phase === 'downloading' || phase === 'compiling' || phase === 'proving');

  const remainingMs = estimatedMs && elapsedMs < estimatedMs ? estimatedMs - elapsedMs : null;

  return (
    <div
      className={styles.panel}
      role="status"
      aria-live="polite"
      aria-label={`Proof status: ${PHASE_LABELS[phase]}`}
    >
      <div className={styles.header}>
        <span className={styles.statusIcon} aria-hidden="true">
          {PHASE_ICONS[phase]}
        </span>
        <div>
          <p className={styles.title}>{PHASE_LABELS[phase]}</p>
          {phaseLabel && <p className={styles.phase}>{phaseLabel}</p>}
        </div>
      </div>

      {showDownloadBar && (
        <>
          <ProgressBar
            percent={downloadProgress * 100}
            label={
              totalDownloadBytes > 0
                ? `Downloaded ${formatBytes(Math.round(downloadProgress * totalDownloadBytes))} of ${formatBytes(totalDownloadBytes)}`
                : `${Math.round(downloadProgress * 100)}%`
            }
          />
          <div className={styles.timerRow}>
            <span className={styles.elapsed}>Elapsed: {formatMs(elapsedMs)}</span>
          </div>
        </>
      )}

      {showIndeterminate && (
        <>
          <ProgressBar label={phaseLabel ?? PHASE_LABELS[phase]} />
          <div className={styles.timerRow}>
            <span className={styles.elapsed}>Elapsed: {formatMs(elapsedMs)}</span>
            {remainingMs !== null && (
              <span className={styles.estimate}>~{formatMs(remainingMs)} remaining</span>
            )}
          </div>
        </>
      )}

      {phase === 'done' && (
        <div className={styles.result}>
          <div className={styles.successRow}>
            <span aria-hidden="true">✓</span>
            <span>Proof generated successfully</span>
          </div>
          {provingTimeMs !== undefined && (
            <div className={styles.meta}>
              <span>Proving time: {formatMs(provingTimeMs)}</span>
            </div>
          )}
        </div>
      )}

      {phase === 'error' && error && (
        <p
          role="alert"
          style={{ color: 'var(--color-danger-text)', margin: 0, fontSize: '0.875rem' }}
        >
          {error}
        </p>
      )}

      {showCancel && (
        <Button
          variant="secondary"
          className={styles.cancelBtn}
          onClick={onCancel}
          aria-label="Cancel proof generation"
        >
          Cancel
        </Button>
      )}
    </div>
  );
}
