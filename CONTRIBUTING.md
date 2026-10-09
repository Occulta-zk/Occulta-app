# Contributing

Most open-source contributors to a project like this are frontend developers, not
cryptography engineers — this repo is deliberately the on-ramp. Small, well-scoped PRs
here (an accessibility fix, a new design-system primitive, a demo README explaining a
circuit's public signals) are genuinely valuable and a great first contribution.

## Before you start

1. Read [`SECURITY.md`](SECURITY.md). The ten invariants there are not style
   preferences — a PR that violates one gets closed regardless of how good the rest of
   it is.
2. If your change touches anything that could see a note, seed, mnemonic, or witness
   input, re-read [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) first.
3. Check `deployments/testnet.json` / the README's [Status](README.md#status) section
   before assuming an SDK function or contract exists — several are still scaffolding
   upstream in `occulta-sdk`. Don't invent the API you wish existed; open an issue there
   instead, or ask.

## Rules that apply to every PR

- **No backend.** Nothing under `app/api/` may touch a secret. See
  `app/api/README.md`.
- **No cryptography here.** If you're importing `circomlibjs`, writing a Merkle path,
  or otherwise doing math a verifier would care about, that belongs in `occulta-sdk`,
  not here.
- **No analytics, telemetry, or error reporting.** Not even a "privacy-friendly" one.
- **No hardcoded contract IDs or VK hashes.** Read them from `deployments/testnet.json`
  via `lib/deployments.ts`.
- **Proving never runs on the main thread.** All of it happens in
  `workers/prover.worker.ts`.
- **No `localStorage` for secrets, ever.** Use `lib/storage.ts` (IndexedDB + WebCrypto).

## Local setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Before opening a PR:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

CI also runs an accessibility scan (`axe`), a bundle-size budget check, a CSP header
assertion, and a network-egress assertion (intercepts all requests made by
secret-handling code paths and fails if any go somewhere other than the configured
indexer/relayer/RPC). These are blocking, not advisory.

## Good first issues

None of these touch anything cryptographic:

- **Playground:** a mobile layout pass; copying public signals to the clipboard; a
  "what are public signals?" explainer; announcing elapsed proving time to screen readers at
  sensible intervals.
- **Failure messages:** clearer wording for any diagnosis in `lib/playground.ts`, with a test.
- **Accessibility:** anything `pnpm a11y` or a manual screen-reader pass turns up.
- **Tests:** Playwright coverage for cancel-mid-proof and for invalid input handling.

Issues like these are tagged `good-first-issue`.

## Code of conduct

Be direct, be kind, assume good faith. Disagreements about security-relevant tradeoffs
should cite `SECURITY.md` / `docs/THREAT-MODEL.md` rather than intuition.
