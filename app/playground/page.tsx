import type { Metadata } from 'next';
import { SiteHeader } from '@/components/ui/SiteHeader';
import { Playground } from './Playground';
import styles from './playground.module.css';

export const metadata: Metadata = {
  title: 'Playground — Occulta (testnet)',
  description:
    'Generate a Groth16 proof in a Web Worker, verify it locally, and see why it fails when it does.',
};

export default function PlaygroundPage() {
  return (
    <>
      <SiteHeader />
      <main id="main-content" className={styles.main}>
        <section className={styles.intro}>
          <h1>Playground</h1>
          <p>
            Prove a statement in your browser and check the proof. Proving runs in a Web Worker so
            the page stays responsive, and your private inputs never leave this tab.
          </p>
        </section>
        <Playground />
      </main>
    </>
  );
}
