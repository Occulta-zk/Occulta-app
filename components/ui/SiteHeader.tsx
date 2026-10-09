import Link from 'next/link';
import styles from './SiteHeader.module.css';

// Only routes that exist. Add a link when its page ships, not before.
const NAV_LINKS = [{ href: '/playground', label: 'Playground' }];

const SOURCE_URL = 'https://github.com/Occulta-zk/occulta-app';

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand}>
          Occulta
        </Link>
        <nav className={styles.nav} aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
          <a href={SOURCE_URL} rel="noreferrer">
            Source
          </a>
        </nav>
      </div>
    </header>
  );
}
