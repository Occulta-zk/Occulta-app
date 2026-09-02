# Occulta App

The human surface of Occulta: a playground to compile a Circom circuit, prove it in the
browser, and verify it on Stellar testnet — plus demo apps (private vote, anonymous
claim, KYC attestation, confidential payroll) and a note manager, all built on
[`@occulta/core`](../Occulta-SDK) with no cryptography or contract logic of its own.

**Live URL:** not deployed yet — see [Status](#status) below.

> **Testnet only. Unaudited. Not for real assets.** Nothing in this repository has had a
> security audit, and it should never be pointed at Stellar mainnet or used with funds
> or identifying information you care about. See [`SECURITY.md`](SECURITY.md).

<!-- A screenshot or short recording of the playground goes here once the playground has
     something to show — see Status. -->

## Status

This app is being built milestone-by-milestone against a spec that assumes a mature
SDK and deployed contracts. As of now:

- ✅ **M1 — Foundation.** Next.js scaffold, strict CSP (`middleware.ts`, `lib/csp.ts`),
  design-system primitives (`components/ui`), CI with accessibility and network-egress
  checks.
- 🚧 **M2 — Wallet + storage (partial).** Freighter wallet connection
  (`components/wallet/WalletConnect`, `lib/wallet.ts`, verified live against
  `@stellar/freighter-api@6.0.1`'s real API — `getAddress`/`isAllowed`/`requestAccess`/
  `signTransaction`/`isConnected`, all data-not-exception error shapes) and encrypted
  IndexedDB storage (`lib/storage.ts`) are done. Passkey smart wallets are not implemented
  pending a VERIFY pass on the Stellar smart-wallet API. The forced-backup flow and
  mnemonic-derived note creation are gated on `@occulta/core` becoming an installable
  dependency (see below) — `NoteStore`/`deriveNote` exist and are correctly typed against
  in `lib/occulta.ts`, but nothing calls them yet.
- 🚧 **M3 — Prover worker (partial).** `workers/prover.worker.ts` runs snarkjs in a Web
  Worker with real progress events, cancellation, and artefact caching, calling
  `groth16.fullProve` with the correct `{type:'mem', data:Uint8Array}` input shape
  (verified against the installed `snarkjs@0.7.6`). Not yet wired to a page, and not yet
  routed through `@occulta/core`'s `prove()` — see the dependency blocker below.
- ⬜ **M4–M8** (playground, note manager balances, demos, docs site): not started —
  blocked on both the `@occulta/core` dependency below and `deployments/testnet.json`
  still being empty (no contracts deployed to testnet by `occulta-sdk`/
  `occulta-smartcontract` yet).

**Current blocker — `@occulta/core` isn't an installable dependency yet.** `occulta-sdk`
now has a real, tested `@occulta/core` (`NoteStore`, `MerkleMirror`, `deriveNote`, `prove`,
`verifyLocal`, `submit`, …), but it isn't published to a registry and its `dist/` build
output is gitignored, so there's no dependency spec — npm, or pnpm's
[git+subdirectory syntax](https://pnpm.io/package-sources) (`github:Occulta-zk/Occulta-sdk#
<commit>&path:/packages/core`, verified to exist as a real pnpm feature) — that currently
resolves it: the git+path route needs a `prepare` build hook in `occulta-sdk`'s
`packages/core/package.json` that doesn't exist yet. Until one of those lands, `lib/occulta.ts`
is typed against `types/occulta-core.d.ts`, a hand-maintained mirror of the real, verified
SDK surface (not an invented one — see that file's header for the exact provenance), and
`loadCore()` throws a clear error at runtime rather than silently stubbing anything out.

## Quickstart

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open http://localhost:3000. This talks to whatever indexer/relayer/RPC endpoints you
configure (defaults are testnet-only and clearly labelled with who operates them); it
never talks to a backend of its own — see `app/api/README.md`.

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm test        # vitest (unit + component + security-regression)
pnpm build       # next build
```

## Documentation

- [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) — what a passive chain observer, the
  indexer operator, the relayer operator, the frontend host, and the optional prover
  operator can each see.
- [`docs/SELF-HOSTING.md`](docs/SELF-HOSTING.md) — running your own copy and verifying
  published build hashes.
- [`SECURITY.md`](SECURITY.md) — the security invariants this repo holds itself to.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to contribute, and why frontend
  contributions are especially welcome here.

## Repository layout

See `CONTRIBUTING.md` for the full structure. In short: `app/` (routes), `components/`
(design system + feature components), `lib/` (thin wrappers over `@occulta/core` and the
indexer/relayer/wallet clients — no crypto lives here), `workers/` (all proving happens
in a Web Worker, never the main thread), `e2e/` (Playwright).

## License

Apache-2.0. See [`LICENSE`](LICENSE).

---

_This is independent software, not affiliated with, sponsored, or endorsed by the
Stellar Development Foundation._
