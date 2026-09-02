# Security

Occulta is **testnet-only and unaudited**. Do not use it with real assets or real
identifying information. See [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) for what
each party involved (a passive chain observer, the indexer operator, the relayer
operator, the frontend host, the optional prover operator) can actually see.

## Security invariants

These are non-negotiable for this repository. Any PR that violates one is rejected
regardless of what else it does correctly.

1. **No secret crosses the network.** No API route, no analytics, no error reporter, no
   URL parameter, no `console.log` shipped to a collector.
2. **No third-party scripts on routes that touch secrets.** Preferably none anywhere.
3. **Strict CSP.** No `unsafe-inline`, no `unsafe-eval` — note that wasm requires
   `'wasm-unsafe-eval'`; use exactly that, not the blanket form.
4. **Secrets at rest are encrypted** in IndexedDB with a WebCrypto key derived from a
   user passphrase. Never `localStorage`, never plaintext.
5. **Proving happens in a Web Worker,** never on the main thread.
6. **Merkle paths from an indexer are verified locally** against a chain-known root
   before use.
7. **Never prompt for a secret key or seed phrase to "connect a wallet."**
8. **Refuse deposit and withdrawal from the same account.**
9. **Force a backup before the first deposit.**
10. **Publish build hashes** with every release and document self-hosting, so a user can
    verify the frontend they are running.

## No cryptography, no contract logic, no backend

This repository consumes [`@occulta/core`](https://github.com) (from `occulta-sdk`) and
the contract IDs in `deployments/testnet.json`. It contains no cryptography of its own,
no contract logic of its own, and no backend of its own — `app/api/` stays empty of
anything that touches a note, a seed, or a witness input. The only servers involved are
the indexer and relayer the user chooses.

## Reporting a vulnerability

Please open a private security advisory on the repository (GitHub Security Advisories)
rather than a public issue. This is a testnet research project with no bug bounty, but
we take reports seriously and will credit reporters who ask to be credited.

## Current status

This app is early — see the milestones in the README. Most of the surfaces described in
the build spec (playground proving, on-chain verification, the demos) are not live yet
because the SDK and contracts they depend on
(`@occulta/core`'s `Note`/`NoteStore`/`prove`/`verifyLocal`/`submit`, and any deployed
contract) have not landed. Nothing in this app fabricates those APIs ahead of time —
see `lib/occulta.ts` for what is and isn't wired up yet.
