# Threat model

Occulta hides _which_ commitment you're spending, not _that_ the system exists. Being
precise about who can see what is more honest — and more useful to anyone evaluating
this seriously — than a blanket claim of "privacy." This document is the build spec's
required §10 table, expanded.

**Status:** as of this writing, no circuits are deployed and no contracts are live on
testnet (`deployments/testnet.json` is empty) — this document describes the design's
intended threat model, which the E2E test suite (§8) verifies once the underlying
pieces exist, not a claim about a currently-running system.

## What each party observes

| Party                                                                                                | Sees                                                                                                                                                                                                                                                   | Does not see                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A passive chain observer** (anyone watching Stellar/Soroban ledger data)                           | Every transaction's public signals: the Merkle root a proof was checked against, the nullifier spent, any public amount/recipient a given circuit exposes, transaction timing, the calling account (unless routed through a relayer)                   | Which leaf/commitment in the tree the spender owns, the note's opening (amount + blinding, for circuits that hide amount), the spender's identity if a relayer was used                                                                                                                                                                                     |
| **The indexer operator** (build spec §4.5)                                                           | Every request for a Merkle path or root, request timing, and — unless the user routes through Tor/a VPN — the requester's IP address alongside _which_ path was requested                                                                              | The note's secret values; a well-behaved client verifies the returned path locally against a chain-known root before proving (SECURITY.md #6), so a malicious indexer also cannot poison a proof, only decline to serve one or correlate request timing/IP to a specific leaf index                                                                         |
| **The relayer operator** (build spec §4.5)                                                           | The full transaction it submits, including its public signals, and the caller's IP address at submission time                                                                                                                                          | The connection between the relayer's submission and any specific depositor, _provided_ the withdrawal's anonymity set is large enough and timing is decorrelated from deposit — see the timing-correlation warning (build spec §5.2); the relayer is structurally unable to redirect funds because the recipient is itself a public signal inside the proof |
| **The frontend host** (wherever this app is deployed — Vercel, IPFS, self-hosted)                    | Standard HTTP access logs (IP, path, timing) for whoever loads the page; if compromised or malicious, could serve a tampered build that _does_ exfiltrate secrets — this is why build-hash publication and self-hosting (`docs/SELF-HOSTING.md`) exist | Nothing about on-chain activity by default — this app makes no server-side calls of its own (SECURITY.md #1); a passive host cannot see a secret it is never sent                                                                                                                                                                                           |
| **The optional self-hosted prover operator** (build spec §4.4, only relevant if a user opts into it) | Everything: witness inputs, note secrets, the works — this is the whole tradeoff of using it                                                                                                                                                           | N/A — this path is explicitly labelled as one that sees your secrets, and is opt-in only                                                                                                                                                                                                                                                                    |

## Design implications this drives

- **Local Merkle path verification is mandatory**, not an optimization — it's the only
  thing standing between a malicious indexer and a poisoned proof (invariant #6).
- **Anonymity set size must be surfaced at withdrawal**, with a warning threshold — a
  correct proof over a four-leaf tree is not "private" in any sense a user should rely
  on, and the UI must say so rather than let the word "private" do the lying.
- **Timing and amount correlation are the user's responsibility to manage, and the UI's
  responsibility to warn about** — no cryptographic property here prevents an observer
  from noticing "a 1337.42 XLM deposit was followed nine minutes later by a 1337.42 XLM
  withdrawal."
- **A relayer is a convenience, not a trust upgrade** — it hides the withdrawing
  account's IP/identity from the chain, but the relayer operator sees exactly what a
  chain observer sees for that transaction, plus the caller's IP.

## Out of scope for this document

Circuit-level soundness and the specifics of the Groth16 trusted setup are
`occulta-smartcontract`'s and `occulta-sdk`'s concern, documented in their own
`docs/SECURITY-MODEL.md` and `docs/PLATFORM.md`. This document is scoped to what the
_frontend's_ architecture exposes to each party, per build spec §1: "no cryptography of
its own."
