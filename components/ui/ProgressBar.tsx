import styles from './ProgressBar.module.css';

export interface ProgressBarProps {
  /** Label describing what is happening right now, e.g. "Downloading proving key…" or
   * "Computing witness…". Long-running proving states must always say what stage they're
   * in (build spec §5.1: "honest progress"), never a single generic spinner. */
  label: string;
  /** 0-100. Omit (or pass `undefined`) for an indeterminate stage where no percentage is
   * known yet, e.g. before artifact download reports its first progress event. */
  percent?: number;
  /** Rough remaining-time estimate to display, already formatted (e.g. "~15s left").
   * Optional because an honest "unknown" is better than a fabricated number. */
  etaLabel?: string;
}

/**
 * Accessible progress indicator for long-running operations (artifact download, proving).
 * Uses a native `<progress>` element wrapped in an `aria-live` region so assistive tech
 * announces stage changes without the caller wiring up its own live region each time.
 */
export function ProgressBar({ label, percent, etaLabel }: ProgressBarProps) {
  const isDeterminate = typeof percent === 'number';

  return (
    <div className={styles.wrapper} role="status" aria-live="polite">
      <div className={styles.labelRow}>
        <span>{label}</span>
        {isDeterminate && <span>{Math.round(percent)}%</span>}
      </div>
      <progress
        className={[styles.progress, !isDeterminate ? styles.indeterminate : ''].join(' ')}
        value={isDeterminate ? percent : undefined}
        max={100}
        aria-label={label}
      />
      {etaLabel && <div className={styles.labelRow}>{etaLabel}</div>}
    </div>
  );
}
