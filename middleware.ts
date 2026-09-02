import { NextResponse, type NextRequest } from 'next/server';
import { buildSecurityHeaders } from './lib/csp';

/**
 * Generates a fresh per-request CSP nonce and attaches the full security header set
 * to every response. Next.js automatically applies this nonce to the inline
 * `<script>` tags it generates itself for RSC hydration (documented behaviour: Next
 * detects a `nonce-` source in the CSP header and stamps its own scripts with it) —
 * we never write inline scripts of our own, so this is the only nonce consumer.
 *
 * Edge runtime: uses Web Crypto, no Node-only APIs.
 */
export function middleware(request: NextRequest): NextResponse {
  const nonce = generateNonce();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  for (const [name, value] of Object.entries(buildSecurityHeaders(nonce))) {
    response.headers.set(name, value);
  }

  return response;
}

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export const config = {
  matcher: [
    // Skip static assets and Next's own image optimizer; every page and API route
    // gets the header set.
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
