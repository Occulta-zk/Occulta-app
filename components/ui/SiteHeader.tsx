import Link from 'next/link';
import styles from './SiteHeader.module.css';

const NAV_LINKS = [
  { href: '/playground', label: 'Playground' },
  { href: '/demos/vote', label: 'Demos' },
  { href: '/notes', label: 'Notes' },
  { href: '/docs', label: 'Docs' },
];

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
        </nav>
      </div>
    </header>
  );
}
