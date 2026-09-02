import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  fullWidth?: boolean;
  children: ReactNode;
}

/**
 * Base button primitive. Always renders a real `<button>` (never a `<div onClick>`) so
 * keyboard and screen-reader behaviour is correct for free — part of the WCAG 2.1 AA bar
 * in build spec §7.
 */
export function Button({
  variant = 'primary',
  fullWidth,
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  const classes = [styles.button, styles[variant], fullWidth ? styles.fullWidth : '', className]
    .filter(Boolean)
    .join(' ');

  return <button type={type} className={classes} {...props} />;
}
