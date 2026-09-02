# Self-hosting

A tampered frontend is the standard attack on privacy dApps: a compromised or malicious
build can be made to leak a seed, mis-encode a witness, or submit a withdrawal to the
wrong recipient — all while looking identical to the real thing. The fix is not "trust
us," it's: keep the dependency tree small enough to audit, publish exactly what was
built, and make running your own copy a first-class, documented path rather than an
afterthought.

## Verify a hosted build

Every release publishes:

- The exact commit hash the deployment was built from.
- A SHA-256 hash of the built output (`next build` artefact), computed the same way the
  reproducible-build CI job computes it.

Compare the hash your browser is actually serving against the published one before
connecting a wallet with anything you care about. _(Once releases exist, the exact
commands and current hashes will be listed here — this app has not cut a release yet.)_

## Run it yourself

```bash
git clone <this-repo>
cd occulta-app
pnpm install
cp .env.example .env.local
# fill in NEXT_PUBLIC_DEFAULT_INDEXER_URL / NEXT_PUBLIC_DEFAULT_RELAYER_URL if you want
# non-empty defaults; the app also lets you set these per-session in Settings.
pnpm build
pnpm start
```

Nothing in this app requires a server component beyond serving static files and the
Next.js RSC shell — there is no database, no API key, and no secret configuration
(`app/api/` is kept empty on purpose; see `SECURITY.md`). You can equally serve the
static export from IPFS, a static host, or your own box.

## Reproducing a build

The CI reproducible-build job (`build spec §9`, release stage) builds from a clean
checkout with a pinned `pnpm-lock.yaml` and no network access beyond the package
registry, then hashes the output. Once that job exists and has run, this section will
document the exact steps to reproduce it locally and compare against a published hash.

## Choosing your own indexer / relayer

Both are user-configurable (build spec §4.5) precisely so you're not stuck trusting the
defaults. See `docs/THREAT-MODEL.md` for what each operator can see regardless of who
runs it — self-hosting the frontend does not change what an indexer or relayer observes,
only whether you trust the code asking you to pick one.
