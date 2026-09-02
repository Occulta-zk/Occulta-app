/**
 * Content-Security-Policy construction — the single source of truth for the app's CSP.
 *
 * Kept as a pure function (no Next.js imports) so it can be unit-tested directly
 * (see test/csp.test.ts) without spinning up a server. `middleware.ts` is the only
 * caller in the running app.
 *
 * Invariant (SECURITY.md #3): no `unsafe-inline`, no `unsafe-eval`. The one exception
 * is `'wasm-unsafe-eval'` in `script-src`, which is the narrow, wasm-specific grant —
 * not the blanket `unsafe-eval` — required for the prover worker to instantiate
 * snarkjs's WebAssembly module. Every inline script/style the app itself renders
 * (e.g. Next.js's RSC hydration payload) is authorized by a fresh per-request nonce
 * instead of a blanket allowance.
 */

/** Third-party origins the app is allowed to talk to, beyond its own origin. Empty on
 * purpose: indexer/relayer/RPC endpoints are user-configured at runtime (lib/indexer.ts,
 * lib/relayer.ts) and connected via `connect-src` there, never baked in as a fixed list
 * of trusted third parties here. */
export const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
  styleSrc: ["'self'"],
  imgSrc: ["'self'", 'data:'],
  fontSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'none'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  workerSrc: ["'self'"],
  manifestSrc: ["'self'"],
} as const;

/**
 * Builds the Content-Security-Policy header value for one request.
 *
 * @param nonce - a fresh, random, base64 value generated per-request by middleware.ts.
 *   Never reused across requests — a reusable nonce is not a nonce.
 */
export function buildCsp(nonce: string): string {
  const scriptSrc = [...CSP_DIRECTIVES.scriptSrc, `'nonce-${nonce}'`, "'strict-dynamic'"];
  const styleSrc = [...CSP_DIRECTIVES.styleSrc, `'nonce-${nonce}'`];

  const directives: Record<string, readonly string[]> = {
    'default-src': CSP_DIRECTIVES.defaultSrc,
    'script-src': scriptSrc,
    'style-src': styleSrc,
    'img-src': CSP_DIRECTIVES.imgSrc,
    'font-src': CSP_DIRECTIVES.fontSrc,
    'object-src': CSP_DIRECTIVES.objectSrc,
    'base-uri': CSP_DIRECTIVES.baseUri,
    'form-action': CSP_DIRECTIVES.formAction,
    'frame-ancestors': CSP_DIRECTIVES.frameAncestors,
    'worker-src': CSP_DIRECTIVES.workerSrc,
    'manifest-src': CSP_DIRECTIVES.manifestSrc,
    'upgrade-insecure-requests': [],
  };

  return Object.entries(directives)
    .map(([name, values]) => (values.length > 0 ? `${name} ${values.join(' ')}` : name))
    .join('; ');
}

/** Additional hardening headers applied alongside the CSP. */
export function buildSecurityHeaders(nonce: string): Record<string, string> {
  return {
    'Content-Security-Policy': buildCsp(nonce),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}
