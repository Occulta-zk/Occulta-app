# Occulta App

The browser side of Occulta: a working foundation for privacy applications on Stellar, and a
playground that generates a real Groth16 proof in a Web Worker, verifies it locally, and tells
you _why_ verification failed when it does. It is built on
[`@occulta/core`](https://github.com/Occulta-zk/occulta-sdk) and contains no cryptography of its
own.

> **Testnet only. Unaudited. Not for real assets.** Nothing in this repository has had a
> security audit, and it should never be pointed at Stellar mainnet or used with funds
> or identifying information you care about. See [`SECURITY.md`](SECURITY.md).

## Status

| Surface                                                        | State                                                                                                                 |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Landing page                                                   | Implemented                                                                                                           |
| Prover worker · storage · wallet · indexer and relayer clients | Implemented — library layer                                                                                           |
| Playground                                                     | Implemented — proves and verifies locally against a dev-fixture circuit; on-chain step blocked (no registry deployed) |
| Demos — vote, claim, attestation, payroll                      | Not implemented                                                                                                       |
| Note manager                                                   | Not implemented — `lib/storage.ts` is its storage layer                                                               |

What blocks the rest is upstream, and the app says so rather than faking it:

- `deployments/testnet.json` (mirrored from `occulta-sdk`) lists no contracts and no circuits.
- The VK registry contract in `occulta-contracts` is a milestone-M5 stub, so there is nothing
  on testnet to verify against, and no instruction budget to measure.
- `occulta-sdk` has not published `@occulta/core` or any compiled circuit yet.

## What's here

**A privacy-app foundation**, about 3,200 lines of it, built so that a secret has nowhere to leak:

- **An egress assertion in CI.** [`test/network-egress.test.ts`](test/network-egress.test.ts)
  drives the real prover worker through a proof and a verification and fails the build if it
  fetches anything but same-origin artefacts, or if any message it posts back contains a
  private input. It also scans the playground's source for hardcoded third-party request URLs
  and tests that a tampered Merkle path is rejected against the chain's root, not the root the
  indexer claims. It is a blocking CI step (`pnpm egress-check`). Few frontends test this at all.
- **Encrypted storage.** `lib/storage.ts` is an IndexedDB vault in which every value is
  AES-256-GCM encrypted under a key derived from a passphrase (PBKDF2-SHA256, 600,000
  iterations). It has an encrypted export/import path for backups, and nothing goes to
  `localStorage` or a cookie.
- **A strict CSP with per-request nonces.** `middleware.ts` + `lib/csp.ts` issue no
  `unsafe-inline` and no `unsafe-eval`. The one grant is `'wasm-unsafe-eval'`, which the prover
  needs. Every route renders per request so Next.js can stamp the nonce on its own scripts, and
  a Playwright test fails if any page hits a CSP violation while hydrating.
- **Proving isolated in a worker.** `workers/prover.worker.ts` streams artefact downloads,
  caches them for the worker's lifetime, sanitises error messages so a prover failure can't
  leak a witness value, and can be cancelled. Cancelling terminates the worker.
- **A wallet adapter that never asks for a seed.** `lib/wallet.ts` + `components/wallet` are
  built against `@stellar/freighter-api@6.0.1`. They never render a field that could accept a
  secret key, and they reject a withdrawal aimed at the account that deposited.
- **Indexer and relayer clients.** The indexer client recomputes every Merkle path's root and
  checks it against a root fetched from the chain before the path can be used. (It hashes with
  `@occulta/core`'s Poseidon, so it runs once the SDK is installable.) The relayer client
  refuses to submit until a fee quote has been shown.
- **No hardcoded addresses.** Contract IDs and VK hashes are read only through
  `lib/deployments.ts` from `public/deployments/testnet.json`, a schema-validated mirror of
  `occulta-sdk`'s manifest. `pnpm deployments:check` fails if the mirror drifts from upstream.
- **Accessibility and bundle budgets in CI.** `scripts/axe-scan.ts` (WCAG 2.1 AA on every
  route) and `scripts/bundle-budget.ts` (250 kB gz initial JS; proving artefacts may never
  enter the bundle).

**The playground** (`/playground`) runs the whole proving path in the browser with one click,
using a preloaded example:

1. Loads the circuit's wasm, zkey, and verification key from the same origin.
2. Proves in the worker. Private inputs never leave the tab.
3. Verifies locally and shows **proving time, local verification time, constraint count, and
   artefact size**. On a desktop Chrome the example proves in roughly 0.7 s, with 518
   constraints and 1.9 MB of artefacts.
4. Names the failure when verification fails. A bare "proof verification failed" tells you
   nothing, so the playground checks for the three real causes:
   - **Public-signal order mismatch.** The proof is valid but the signals were encoded in the
     wrong order. The playground finds the ordering that verifies and shows it.
   - **VK for a different circuit or setup.** Detected from the public-signal count, or
     because no ordering verifies.
   - **Poseidon parameter mismatch.** The circuit's hash is compared against
     `occulta-contracts`' published BN254 reference vectors, which are the parameters the
     contract hashes with.

   A "Reproduce a failure" panel triggers each one for real: it swaps the signals, verifies
   against a VK from an independent second setup, and compares against the BLS12-381
   parameter set.

5. On-chain verification and the instruction budget: shown as **not available**, with the
   reason read from `deployments/testnet.json`. No number is shown that wasn't measured.

The circuit is a **development fixture**: `fixtures/playground/poseidon_preimage.circom`, which
only instantiates circomlib's `Poseidon(2)`. It has a single-party throwaway trusted setup,
labelled as such on the page. It is regenerated reproducibly by `pnpm fixture:playground`
(circom 2.2.2, circomlib v2.0.5), and the script records each artefact's size, SHA-256, and the
`occulta-contracts` commit its reference vectors came from. It will be deleted when
`occulta-sdk` ships real circuits.

## Planned

These surfaces will be built once their upstream dependencies land. None of them exist yet.

- **On-chain verification in the playground** will read the registry's contract ID from
  `deployments/testnet.json`, simulate the verify call, and show the instructions it consumed
  as a share of the per-transaction limit. (For scale, `occulta-contracts/docs/BUDGET.md` cites
  SDF's measurement of about 40M instructions, roughly 40% of the testnet limit, for one
  Groth16 verification.)
- **Demos** will cover a private vote with per-poll external nullifiers, an anonymous
  allowlist claim, a KYC attestation, and ShieldRoll, a confidential payroll.
- **Note manager** will create or import a mnemonic, derive notes deterministically, force an
  encrypted backup before the first deposit, and rescan an indexer to recover notes.

## Architecture rules

**No secret ever crosses the network, and this app has no backend.** `app/api/` stays empty on
purpose (see [`app/api/README.md`](app/api/README.md)). The only servers involved will be the
indexer, relayer, and Stellar RPC the user chooses. `docs/THREAT-MODEL.md` sets out what each
operator can see. Also: no analytics, telemetry, or error reporting; no third-party scripts; no
cryptography outside `@occulta/core` (`lib/occulta.ts` is the only file that imports it); and
no proving on the main thread.

[`SECURITY.md`](SECURITY.md) lists the full set of invariants. Some of them (a backup before the
first deposit, published reproducible build hashes) apply to flows that don't exist yet, and
become enforceable when those flows are built.

## Quickstart

```bash
pnpm install
cp .env.example .env.local
pnpm dev                 # open http://localhost:3000/playground
```

```bash
pnpm typecheck           # tsc --noEmit
pnpm lint                # eslint
pnpm test                # vitest: unit, real-proof integration, CSP and egress regressions
pnpm build && pnpm test:e2e   # Playwright: one click → real proof → verified locally
```

## Repository layout

```
app/            routes: / (landing) and /playground
components/     ui/ (design-system primitives), proving/ (progress, budget, anonymity set),
                wallet/ (Freighter connection)
lib/            occulta.ts (the only @occulta/core import), playground.ts, wallet.ts, storage.ts,
                indexer.ts, relayer.ts, deployments.ts, csp.ts
workers/        prover.worker.ts: all proving and verification happen here
fixtures/       playground/: the dev-fixture circuit source
public/         deployments/testnet.json (mirror), fixtures/playground/ (compiled artefacts)
scripts/        axe scan, bundle budget, fixture generation, deployment-manifest sync
test/  e2e/     vitest suites, Playwright suites
```

## Documentation

- [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) covers what a chain observer and the indexer,
  relayer, frontend host, and prover operators can each see.
- [`docs/SELF-HOSTING.md`](docs/SELF-HOSTING.md) covers running your own copy.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) explains how to contribute; frontend contributions are
  especially welcome.

## License

Apache-2.0. See [`LICENSE`](LICENSE).

---

_This is independent software, not affiliated with, sponsored, or endorsed by the
Stellar Development Foundation._
