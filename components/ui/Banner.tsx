import type { ReactNode } from 'react';
import styles from './Banner.module.css';

export type BannerVariant = 'info' | 'warning' | 'danger';

export interface BannerProps {
  variant: BannerVariant;
  title?: string;
  children: ReactNode;
  /** Marks this banner as a live region so screen readers announce it the moment it
   * appears — required for anything that shows up in response to a user action, such as
   * the anonymity-set warning at withdrawal time (build spec §4.5, §5.2). Static banners
   * that are always on the page (e.g. the testnet notice) should leave this false. */
  live?: boolean;
}

const ICON: Record<BannerVariant, string> = {
  info: 'ℹ',
  warning: '⚠',
  danger: '⛔',
};

export function Banner({ variant, title, children, live = false }: BannerProps) {
  const classes = [styles.banner, styles[variant]].join(' ');

  return (
    <div
      className={classes}
      role={live ? (variant === 'danger' ? 'alert' : 'status') : undefined}
      aria-live={live ? (variant === 'danger' ? 'assertive' : 'polite') : undefined}
    >
      <span className={styles.icon} aria-hidden="true">
        {ICON[variant]}
      </span>
      <div className={styles.body}>
        {title && <p className={styles.title}>{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}
