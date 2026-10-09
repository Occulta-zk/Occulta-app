import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Occulta — privacy on Stellar (testnet)',
  description:
    'Playground and demo apps for zero-knowledge privacy on Stellar testnet. Unaudited, testnet only, not for real assets.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // A per-request CSP nonce can't be baked into a page prerendered at build time, so every
  // route renders per request. Reading the request headers is what opts the tree into that.
  await headers();

  return (
    <html lang="en">
      <body>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
