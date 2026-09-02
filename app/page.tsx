import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Link from 'next/link';
import { SiteHeader } from '@/components/ui/SiteHeader';
import { Banner, Card, LinkButton } from '@/components/ui';
import { deploymentManifestSchema, hasAnyDeployment } from '@/lib/deployments';
import styles from './page.module.css';

/**
 * Reads the deployment manifest straight off disk (this is a Server Component; there is
 * no running server to `fetch()` from during the build) so the landing page never claims
 * a live demo exists when `deployments/testnet.json` says nothing is deployed yet
 * (build spec §2, §12 — "do not hardcode... nothing production-ready").
 */
async function getDeploymentStatus() {
  const filePath = path.join(process.cwd(), 'public', 'deployments', 'testnet.json');
  const raw = await readFile(filePath, 'utf-8');
  const manifest = deploymentManifestSchema.parse(JSON.parse(raw));
  return { manifest, isLive: hasAnyDeployment(manifest) };
}

export default async function LandingPage() {
  const { isLive, manifest } = await getDeploymentStatus();

  return (
    <>
      <SiteHeader />
      <main id="main-content" className={styles.main}>
        <Banner variant="warning" title="Testnet only — unaudited — not for real assets">
          Occulta runs exclusively on Stellar testnet. Nothing here has been audited. Nothing here
          custodies real value. See <Link href="/docs/threat-model">the threat model</Link> before
          connecting a wallet.
        </Banner>

        <section className={styles.hero}>
          <h1>Zero-knowledge privacy for Stellar, in the open.</h1>
          <p className={styles.lede}>
            A playground to compile a circuit, prove it in your browser, and verify it on-chain —
            plus working demos (private voting, anonymous claims, KYC attestation, confidential
            payroll) built on the same primitives you can reuse.
          </p>

          {isLive ? (
            <div className={styles.actions}>
              <LinkButton href="/playground">Open the playground</LinkButton>
            </div>
          ) : (
            <Banner variant="info">
              <strong>Nothing is deployed to testnet yet.</strong> The circuits and contracts this
              playground needs ({Object.keys(manifest.contracts).length} contracts,{' '}
              {Object.keys(manifest.circuits).length} circuits registered) haven&apos;t landed from{' '}
              <code>occulta-sdk</code> / <code>occulta-smartcontract</code> yet — this page will
              switch to live demo links the moment <code>deployments/testnet.json</code> lists one.
              Track progress in{' '}
              <a href="https://github.com" rel="noreferrer">
                the project repos
              </a>
              .
            </Banner>
          )}
        </section>

        <section className={styles.grid} aria-label="What this project is">
          <Card>
            <h2>Playground</h2>
            <p>
              Paste or upload a Circom circuit, compile it to wasm, prove it with a worker (never
              the main thread), and verify the proof on-chain — with a live budget meter against the
              testnet instruction limit.
            </p>
          </Card>
          <Card>
            <h2>Demos</h2>
            <p>
              Four complete flows, not mockups: private vote, anonymous allowlist claim, KYC
              attestation, and confidential payroll (ShieldRoll).
            </p>
          </Card>
          <Card>
            <h2>Note manager</h2>
            <p>
              Create or import a mnemonic, back it up before you ever deposit, and rescan an indexer
              to recover your notes. Secrets never leave your device.
            </p>
          </Card>
        </section>

        <section aria-label="Independence disclaimer" className={styles.disclaimer}>
          <p>
            This is independent software, not affiliated with, sponsored, or endorsed by the Stellar
            Development Foundation.
          </p>
        </section>
      </main>
    </>
  );
}
