import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SiteHeader } from '@/components/ui/SiteHeader';
import { Banner, Card, LinkButton } from '@/components/ui';
import { deploymentManifestSchema, hasAnyDeployment } from '@/lib/deployments';
import styles from './page.module.css';

const REPO = 'https://github.com/Occulta-zk/occulta-app';

/**
 * Reads the deployment manifest straight off disk (this is a Server Component) so the
 * landing page never claims something is live on testnet when `deployments/testnet.json`
 * says nothing is deployed yet.
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
          Occulta targets Stellar testnet exclusively. Nothing here has been audited and nothing
          here custodies real value. Read{' '}
          <a href={`${REPO}/blob/main/docs/THREAT-MODEL.md`} rel="noreferrer">
            the threat model
          </a>{' '}
          before connecting a wallet.
        </Banner>

        <section className={styles.hero}>
          <h1>Zero-knowledge privacy for Stellar, in the open.</h1>
          <p className={styles.lede}>
            The browser side of Occulta: a prover that runs in a Web Worker, an encrypted on-device
            vault, a wallet adapter, and indexer and relayer clients that never see a secret. Try
            the playground to generate and check a real Groth16 proof in your browser.
          </p>
          <div className={styles.actions}>
            <LinkButton href="/playground">Open the playground</LinkButton>
          </div>
          {!isLive && (
            <Banner variant="info">
              <strong>Nothing is deployed to testnet yet.</strong>{' '}
              <code>deployments/testnet.json</code> lists {Object.keys(manifest.contracts).length}{' '}
              contracts and {Object.keys(manifest.circuits).length} circuits, so on-chain
              verification is not available. The playground proves and verifies locally and says
              plainly which steps are still blocked.
            </Banner>
          )}
        </section>

        <section className={styles.grid} aria-label="What exists today">
          <Card>
            <h2>Playground</h2>
            <p>
              Prove a statement in a Web Worker, verify it locally, and get a named reason when
              verification fails. Shows proving time, constraint count, and artefact size.
            </p>
          </Card>
          <Card>
            <h2>Privacy foundation</h2>
            <p>
              AES-256-GCM encrypted IndexedDB storage, per-request CSP nonces, a Freighter adapter
              that never asks for a seed, and a CI test that fails if secret-handling code talks to
              an unexpected origin.
            </p>
          </Card>
          <Card>
            <h2>Planned</h2>
            <p>
              Demo apps (private vote, anonymous claim, attestation, payroll) and a note manager.
              They depend on contracts and circuits that haven&apos;t shipped upstream yet.
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
