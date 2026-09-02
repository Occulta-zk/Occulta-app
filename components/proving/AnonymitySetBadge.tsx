'use client';

/**
 * AnonymitySetBadge — displays anonymity set size with an honest assessment
 * (build spec §4.5, §5).
 *
 * Security requirement: calling a withdrawal "private" when the tree holds 4
 * commitments is a lie the UI must refuse to tell. This badge makes the set
 * size visible and prominent, not tucked in a tooltip.
 */

import { anonymitySetDescription } from '@/lib/indexer';

interface AnonymitySetBadgeProps {
  size: number;
}

const LEVEL_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  critical: {
    bg: 'var(--color-danger-bg)',
    border: 'var(--color-danger-border)',
    text: 'var(--color-danger-text)',
  },
  low: {
    bg: 'var(--color-warning-bg)',
    border: 'var(--color-warning-border)',
    text: 'var(--color-warning-text)',
  },
  moderate: {
    bg: 'var(--color-info-bg)',
    border: 'var(--color-info-border)',
    text: 'var(--color-info-text)',
  },
  good: {
    bg: 'var(--color-bg-raised)',
    border: 'var(--color-border)',
    text: 'var(--color-text)',
  },
};

export function AnonymitySetBadge({ size }: AnonymitySetBadgeProps) {
  const { level, message } = anonymitySetDescription(size);
  const s = LEVEL_STYLES[level] ?? LEVEL_STYLES.good!;

  return (
    <div
      role={level === 'critical' || level === 'low' ? 'alert' : 'status'}
      aria-live={level === 'critical' ? 'assertive' : 'polite'}
      style={{
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--space-3) var(--space-4)',
        color: s.text,
        fontSize: '0.875rem',
        lineHeight: 1.4,
      }}
    >
      <strong>Anonymity set: {size}</strong>
      <p style={{ margin: '4px 0 0' }}>{message}</p>
    </div>
  );
}
