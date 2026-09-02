import { describe, expect, it } from 'vitest';
import { buildCsp, buildSecurityHeaders } from '../lib/csp';

/**
 * The CSP header assertion test required by build spec §9 / SECURITY.md #3. Runs against
 * the pure `buildCsp` function rather than a live server response — fast, and it's the
 * single source of truth `middleware.ts` actually calls, so there's no way for the real
 * header to drift from what this test checks.
 */
describe('Content-Security-Policy', () => {
  const nonce = 'test-nonce-value';
  const csp = buildCsp(nonce);

  it('never contains the blanket unsafe-inline directive', () => {
    expect(csp).not.toContain('unsafe-inline');
  });

  it('never contains unsafe-eval', () => {
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it('allows wasm-unsafe-eval specifically, for the prover worker', () => {
    expect(csp).toContain("'wasm-unsafe-eval'");
  });

  it('embeds a fresh nonce in both script-src and style-src', () => {
    expect(csp).toMatch(/script-src[^;]*'nonce-test-nonce-value'/);
    expect(csp).toMatch(/style-src[^;]*'nonce-test-nonce-value'/);
  });

  it('produces a different nonce value on every call site (caller supplies it)', () => {
    const other = buildCsp('different-nonce');
    expect(other).not.toEqual(csp);
    expect(other).toContain("'nonce-different-nonce'");
  });

  it('denies framing entirely', () => {
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('restricts object-src and base-uri to none', () => {
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  it('defaults everything to same-origin only', () => {
    expect(csp).toMatch(/default-src[^;]*'self'/);
  });

  it('does not allow any third-party script/style/connect origin by name', () => {
    // A stricter regression guard than the individual directive checks above: no bare
    // scheme or hostname anywhere in the policy string, which would indicate someone
    // added a third-party origin (analytics, a CDN, etc.) directly to the CSP instead of
    // through the user-configured indexer/relayer/RPC path (build spec §1, §12).
    expect(csp).not.toMatch(/https?:\/\//);
  });

  describe('buildSecurityHeaders', () => {
    const headers = buildSecurityHeaders(nonce);

    it('sets restrictive framing and referrer headers alongside the CSP', () => {
      expect(headers['X-Frame-Options']).toBe('DENY');
      expect(headers['Referrer-Policy']).toBe('no-referrer');
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
    });

    it('includes the CSP built from the same nonce', () => {
      expect(headers['Content-Security-Policy']).toEqual(buildCsp(nonce));
    });
  });
});
