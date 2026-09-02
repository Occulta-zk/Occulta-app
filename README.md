# Occulta App

The human surface of Occulta: a browser-based playground to compile a Circom circuit,
generate a Groth16 proof without the circuit's private inputs ever leaving your device, and
verify that proof on Stellar — plus a set of complete demo applications (private voting,
anonymous allowlist claims, KYC attestation, confidential payroll) and a note manager for
holding shielded value, all built on top of [`@occulta/core`](../Occulta-SDK) with no
cryptography or contract logic of its own.

> **Testnet only. Unaudited. Not for real assets.** Nothing in this repository has had a
> security audit, and it should never be pointed at Stellar mainnet or used with funds
> or identifying information you care about. See [`SECURITY.md`](SECURITY.md).

<!-- A screenshot or short recording of the playground goes here. -->

## What Occulta is

Occulta is a zero-knowledge toolkit for Stellar: a way to prove a fact about hidden data —
"I hold a note worth this much," "I'm a member of this set," "I'm over 18 and KYC'd by an
approved issuer" — and have a Soroban contract act on that proof without ever learning the
underlying secret. The proving and cryptography live in [`occulta-sdk`](../Occulta-SDK)
(`@occulta/core`: Poseidon hashing, note derivation, Merkle mirroring, Groth16 proving and
verification, Stellar transaction submission) and the on-chain verifier, Merkle tree, and
nullifier registry live in `occulta-smartcontract`. This repository is the third leg: the
part a person actually opens in a browser.

That gives this app three jobs:

- **Prove the stack works.** Open a URL, paste or pick a circuit, and watch a real proof get
  generated in-browser and verified on-chain — the fastest way to turn "interesting crate"
  into "working system" for anyone evaluating the project.
- **Be the playground.** Circuit in, proof out, verified on-chain, with the instruction
  budget it consumed shown live. Nothing else does this for Stellar today.
- **Be the contributor funnel.** Most open-source contributors are frontend engineers, not
  cryptographers — this is the repo where that energy has somewhere to go.

The app is built around three product surfaces:

- **Playground** — paste or upload a Circom circuit, compile it to WebAssembly, supply
  inputs, prove it in a Web Worker (never the main thread), verify the proof locally, then
  verify it on-chain against the registered verification key. A budget meter shows
  instructions consumed against the testnet per-transaction limit alongside constraint
  count, proving time, and artefact size — the numbers that decide whether a circuit is
  viable, made visible instead of discovered the hard way.
- **Demos** — four complete flows built on the same primitives: a private vote (external
  nullifiers scope one spend to one poll), an anonymous allowlist claim (Merkle membership
  without revealing which entry you are), a KYC attestation (a predicate proof over a
  credential from an approved issuer, revealing neither identity nor issuer), and
  ShieldRoll, a confidential payroll where an employer deposits a total and employees
  withdraw individually with amounts hidden.
- **Note manager** — create or import a mnemonic, derive notes deterministically, back them
  up with an encrypted export before the first deposit, and rescan an indexer to recover
  which on-chain commitments belong to you. The seed and every derived secret stay on the
  device; the chain only ever sees a Poseidon commitment.

## Architecture

**No secret ever crosses the network, and this app has no backend of its own.** `app/api/`
stays deliberately empty — every route in it would be a place a note, seed, or witness
input could leak, so none exists. The only servers involved are the indexer, relayer, and
Stellar RPC endpoint the user chooses, each shown before use with a plain statement of what
its operator can see (`docs/THREAT-MODEL.md`).

- **`middleware.ts` + `lib/csp.ts`** — a strict Content-Security-Policy applied per request
  with a fresh nonce for every inline script/style Next.js's own hydration payload needs.
  No `unsafe-inline`, no `unsafe-eval`; the one deliberate exception is the narrow
  `'wasm-unsafe-eval'` grant in `script-src` that lets the prover worker instantiate
  snarkjs's WebAssembly module — not the blanket form. `test/csp.test.ts` asserts the policy
  directly, so a regression here fails CI, not just a manual check.
- **`components/ui`** — the design-system primitives everything else is built from:
  `Button`, `Banner` (with `role="alert"`/`role="status"` live regions for anything that
  needs a screen reader to notice it), `Card`, `ProgressBar`, `SiteHeader`,
  `VisuallyHidden`. Real semantic elements throughout — a `<button>` is always a `<button>`
  — so keyboard and assistive-tech behaviour comes for free rather than being bolted on.
- **`components/proving`** — `ProgressPanel` (named proving stages with elapsed/remaining
  time and a cancel button, never a bare spinner — a user who thinks the tab has frozen
  closes it mid-proof), `BudgetMeter`, and `AnonymitySetBadge` (a withdrawal is never
  described as private without showing the size of the set it's hiding in).
- **`components/wallet` + `lib/wallet.ts`** — Freighter wallet connection, built against
  `@stellar/freighter-api@6.0.1`'s actual API (`getAddress`, `isAllowed`, `requestAccess`,
  `signTransaction`, `isConnected` — every call returns its result as data with an optional
  `error` field rather than throwing). Nothing in this layer will ever render a field that
  could accept a secret key or seed phrase, and it independently rejects a withdrawal aimed
  at the same account that deposited — the single most common way a privacy protocol gets
  defeated by its own user.
- **`lib/storage.ts`** — an encrypted IndexedDB vault: every value is AES-256-GCM encrypted
  with a key derived from a user passphrase via PBKDF2 (600,000 iterations, SHA-256, the
  2023 OWASP-recommended work factor for PBKDF2-SHA256), with a separate encrypted
  export/import path for backups. Nothing is ever written to `localStorage` or a cookie, and
  the derived key lives only in memory for the lifetime of an unlocked session.
- **`lib/indexer.ts` + `lib/relayer.ts`** — typed clients for the two optional services a
  shielded app needs. The indexer client recomputes a returned Merkle path's root using the
  SDK's Poseidon hash and checks it against a root fetched independently from the chain
  before the path is ever used for proving, so a malicious or out-of-sync indexer cannot
  poison a proof by returning a forged path. The relayer client refuses to submit unless a
  fee quote — the relayer's address and cost — has already been shown to the user.
- **`lib/occulta.ts`** — the single file in this repository that imports from
  `@occulta/core`, and the one a reviewer checks to confirm no cryptography lives in the
  app itself. It re-exports the SDK's real note-derivation, Merkle-mirroring, proving, and
  submission functions under their real names and composes exactly one thing locally: the
  Poseidon-based root recomputation the indexer client needs, following the exact
  level-by-level algorithm the SDK documents for its Merkle proofs.
- **`workers/prover.worker.ts`** — every proof is generated here, never on the main thread,
  because proving a real circuit can take seconds on desktop and considerably longer on a
  mid-range phone; running that on the main thread would freeze the tab and look like a
  crash. The worker streams artefact download progress, caches artefacts for its lifetime so
  a retried proof never re-downloads a multi-megabyte `.zkey`, supports cooperative
  cancellation, and calls `snarkjs.groth16.fullProve` with the in-memory file input shape
  the pinned `snarkjs@0.7.6` actually expects. Every error message is sanitised before it
  leaves the worker — long hex strings and large field elements are stripped — so a prover
  failure can never leak a witness value into a log or an error toast.
- **`lib/deployments.ts`** — the single place that reads `deployments/testnet.json`, the
  manifest of contract IDs, verification-key hashes, and circuit versions published by
  `occulta-sdk`. Nothing in this app hardcodes a contract ID or a VK hash; every call site
  goes through this schema-validated loader instead.

## Security & privacy design

The full set of invariants this app holds itself to — no secret crosses the network, no
third-party scripts on routes that touch secrets, the strict CSP above, encrypted-at-rest
storage, proving confined to a Web Worker, locally-verified Merkle paths, never prompting
for a secret key, refusing same-account deposit/withdraw, forcing a backup before the first
deposit, and publishing reproducible build hashes — are documented verbatim in
[`SECURITY.md`](SECURITY.md), enforced as explicit regression tests in `test/` (network
egress is asserted by intercepting every request a secret-handling code path makes), and
checked on every PR by CI (typecheck, lint, tests, an `axe` accessibility scan, a CSP header
assertion, and a bundle-size budget).

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

```
app/         routes — landing page, playground, demos, note manager, MDX docs site
components/  ui/ (design-system primitives), proving/ (progress, budget, anonymity set),
             wallet/ (Freighter connection), notes/ (note manager UI)
lib/         occulta.ts (the only @occulta/core import), wallet.ts, storage.ts, indexer.ts,
             relayer.ts, deployments.ts, csp.ts — thin, typed wrappers; no crypto here
workers/     prover.worker.ts — all proving happens here, never the main thread
types/       ambient type declarations mirroring verified third-party/SDK API surfaces
e2e/         Playwright, run nightly against testnet
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full breakdown.

## License

Apache-2.0. See [`LICENSE`](LICENSE).

---

_This is independent software, not affiliated with, sponsored, or endorsed by the
Stellar Development Foundation._
