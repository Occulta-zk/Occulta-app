'use client';

/**
 * BudgetMeter — shows the Soroban instruction budget consumed by on-chain verification
 * against the per-transaction limit (build spec §4.1).
 *
 * SDF measured Groth16 verification at ~40% of testnet budget. This visualises that
 * number live so a circuit author knows immediately whether their circuit is viable —
 * no other tool surfaces this today.
 *
 * Uses a native CSS width (no inline `style`) to keep the CSP free of `unsafe-inline`.
 * The fill width is driven by a CSS custom property set as a data attribute.
 *
 * Wait — CSS custom properties on a DOM element ARE inline styles and would need
 * unsafe-inline in style-src. Instead we use data attributes to select visual variants
 * and let the CSS handle the visual fill via a <progress> element approach.
 *
 * Actually, we use a <meter> element which the browser renders natively.
 */

import { VisuallyHidden } from '@/components/ui/VisuallyHidden';
import styles from './BudgetMeter.module.css';

export interface BudgetMeterProps {
  /** Instructions consumed by this proof's on-chain verification call. */
  instructionsUsed: number;
  /** Per-transaction instruction limit. Testnet default: 100_000_000. */
  instructionLimit?: number;
  /** Optional: constraint count for display. */
  constraintCount?: number;
}

// Testnet Soroban instruction limit (from SDF documentation)
const DEFAULT_LIMIT = 100_000_000;

// Warning thresholds
const WARNING_THRESHOLD = 0.6; // 60%
const DANGER_THRESHOLD = 0.85; // 85%

export function BudgetMeter({
  instructionsUsed,
  instructionLimit = DEFAULT_LIMIT,
  constraintCount,
}: BudgetMeterProps) {
  const ratio = Math.min(1, instructionsUsed / instructionLimit);
  const pct = (ratio * 100).toFixed(1);
  const level =
    ratio >= DANGER_THRESHOLD ? 'danger' : ratio >= WARNING_THRESHOLD ? 'warning' : 'safe';

  const formatInstructions = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toString();
  };

  return (
    <div className={styles.meter}>
      <div className={styles.header}>
        <span className={styles.label}>Instruction Budget</span>
        <span className={styles.values}>
          {formatInstructions(instructionsUsed)} / {formatInstructions(instructionLimit)} ({pct}%)
        </span>
      </div>

      {/* Native <meter> element renders without inline style, satisfying CSP */}
      <meter
        className={styles.track}
        value={instructionsUsed}
        min={0}
        max={instructionLimit}
        low={instructionLimit * WARNING_THRESHOLD}
        high={instructionLimit * DANGER_THRESHOLD}
        optimum={0}
        aria-label={`Instruction budget: ${pct}% used`}
      >
        {pct}%
      </meter>

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendDot} data-color="accent" aria-hidden="true" />
          &lt;60% safe
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendDot} data-color="warning" aria-hidden="true" />
          60–85% warning
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendDot} data-color="danger" aria-hidden="true" />
          &gt;85% may fail
        </span>
      </div>

      {constraintCount !== undefined && (
        <p className={styles.values} style={undefined}>
          <VisuallyHidden>Circuit constraints:</VisuallyHidden>
          {constraintCount.toLocaleString()} constraints
        </p>
      )}

      <VisuallyHidden>
        {level === 'safe' && `Instruction budget is safe at ${pct}%.`}
        {level === 'warning' &&
          `Instruction budget is high at ${pct}%. Consider optimising the circuit.`}
        {level === 'danger' &&
          `Instruction budget is critically high at ${pct}%. The transaction may fail on-chain.`}
      </VisuallyHidden>
    </div>
  );
}
