# `app/api/` — keep this empty

This directory must never contain a route handler that sees a note, a seed, a
mnemonic, a witness input, or a passphrase. Occulta has no backend of its own
(build spec §1, §12; `SECURITY.md` invariant #1) — the only servers involved are the
indexer and relayer the user explicitly chooses in Settings, and this app talks to
those directly from the browser, never by proxying through a route here.

If you find yourself wanting to add a route under `app/api/` to "simplify" a client
call, don't. That server-side code runs where the deploying host — not the user — can
see whatever passes through it, which is exactly the failure mode this rule exists to
prevent.

A route here that does **not** touch secrets (e.g. a static health-check with no
request body) is not automatically disallowed by the letter of this rule, but should
still be justified in its own PR description, because the CI egress/secret-handling
checks (`test/network-egress.test.ts`) key off this directory being empty.
