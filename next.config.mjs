// Disabling telemetry here (not just via `next telemetry disable`) so a clone of this
// repo never phones home by default — consistent with "no analytics/telemetry anywhere"
// (build spec §1, SECURITY.md #2). Belt-and-suspenders: also set in .env.example.
process.env.NEXT_TELEMETRY_DISABLED = '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // The Content-Security-Policy itself is set per-request in middleware.ts (it needs a
  // fresh nonce every request, which a static header here can't provide). These are the
  // headers that *are* static and apply to every response, including ones middleware's
  // matcher skips (static assets).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ];
  },

  // Next.js 16 builds with Turbopack by default, which has native WebAssembly support and
  // no equivalent of a webpack() escape hatch — a webpack config here without a matching
  // `turbopack` config is now a hard build error, not just ignored (verified 2026-09-02
  // against Next 16.3.4's own build-time check). Prover artifacts (.zkey, circuit .wasm)
  // are served as static files from public/artifacts or a CDN (build spec §2) and fetched
  // at runtime by the worker via `fetch()` — never `import`ed as a webpack/Turbopack
  // module — so no bundler wasm configuration is actually needed; see workers/prover.worker.ts.
};

export default nextConfig;
