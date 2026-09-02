import type { ElementType, ReactNode } from 'react';

export interface VisuallyHiddenProps {
  as?: ElementType;
  children: ReactNode;
}

/** Content present for screen readers / accessible names but not shown visually. */
export function VisuallyHidden({ as: Component = 'span', children }: VisuallyHiddenProps) {
  return <Component className="visually-hidden">{children}</Component>;
}
