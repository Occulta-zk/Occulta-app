/**
 * Axe accessibility scan (build spec §7, §9).
 *
 * Starts the production build (or a static server), opens key pages in a headless
 * Chromium browser, and runs the axe-core engine. Any WCAG 2.1 AA violation exits
 * non-zero and blocks the CI merge.
 *
 * Run after `pnpm build` as `tsx scripts/axe-scan.ts`.
 *
 * Requires: `playwright` and `@axe-core/playwright` installed (both present in
 * devDependencies). The Next.js build output must exist at `.next/`.
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

// Pages to scan — only routes that exist. Add a route here in the PR that creates it.
const PAGES_TO_SCAN = ['/', '/playground'];

// Axe rule tags: 'wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa'];

async function waitForServer(url: string, retries = 20, delayMs = 500): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 404) return; // 404 means server is up, route just missing
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Server at ${url} did not become ready after ${retries * delayMs}ms`);
}

async function main(): Promise<void> {
  // Spawn `next start` against the built output
  const server = spawn('pnpm', ['start', '--port', '3000'], {
    cwd: root,
    stdio: 'pipe',
    shell: true,
  });

  let serverExited = false;
  server.on('exit', () => {
    serverExited = true;
  });

  try {
    await waitForServer(BASE_URL);

    const browser = await chromium.launch();
    const violations: { page: string; count: number; details: string[] }[] = [];

    for (const pagePath of PAGES_TO_SCAN) {
      const url = `${BASE_URL}${pagePath}`;
      const context = await browser.newContext();
      const page = await context.newPage();

      try {
        const response = await page.goto(url, { waitUntil: 'networkidle' });

        if (response && response.status() >= 500) {
          console.warn(`  ⚠  ${pagePath} returned HTTP ${response.status()} — skipping`);
          await context.close();
          continue;
        }

        const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();

        if (results.violations.length > 0) {
          const details = results.violations.map(
            (v) =>
              `    [${v.impact ?? 'unknown'}] ${v.id}: ${v.description}\n` +
              v.nodes.map((n) => `      → ${n.target.join(', ')}`).join('\n'),
          );
          violations.push({ page: pagePath, count: results.violations.length, details });
          console.error(`\n❌  ${pagePath} — ${results.violations.length} violation(s):`);
          for (const d of details) console.error(d);
        } else {
          console.log(`✅  ${pagePath} — no violations`);
        }
      } finally {
        await context.close();
      }
    }

    await browser.close();

    if (violations.length > 0) {
      const total = violations.reduce((s, v) => s + v.count, 0);
      console.error(
        `\n❌  ${total} axe violation(s) across ${violations.length} page(s). Fix before merging.`,
      );
      process.exitCode = 1;
    } else {
      console.log('\n✅  All pages passed axe WCAG 2.1 AA scan.');
    }
  } finally {
    if (!serverExited) {
      server.kill();
      // Give it a moment to shut down
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
