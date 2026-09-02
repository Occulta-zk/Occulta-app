import Link, { type LinkProps } from 'next/link';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import buttonStyles from './Button.module.css';
import type { ButtonVariant } from './Button';

export interface LinkButtonProps
  extends LinkProps, Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> {
  variant?: ButtonVariant;
  fullWidth?: boolean;
  children: ReactNode;
}

/**
 * A navigation link styled as a button. Kept separate from `Button` rather than adding
 * an `asChild` polymorphic prop there — a `<button>` can never legally contain another
 * interactive element, so "make Button render an anchor" and "make Button wrap one" are
 * different components, not one with a flag.
 */
export function LinkButton({
  variant = 'primary',
  fullWidth,
  className,
  children,
  ...props
}: LinkButtonProps) {
  const classes = [
    buttonStyles.button,
    buttonStyles[variant],
    fullWidth ? buttonStyles.fullWidth : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Link className={classes} {...props}>
      {children}
    </Link>
  );
}
