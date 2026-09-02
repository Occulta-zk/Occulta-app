/**
 * Bundle size budget check (build spec §8, §9).
 *
 * Reads Next.js's build manifest from `.next/` and asserts the initial JS payload
 * (everything the browser must download before the page becomes interactive) stays
 * within the budget. Proving artefacts (.zkey, .wasm) are served lazily from
 * public/artifacts or a CDN and must never appear in this bundle.
 *
 * "Initial JS" is read from `.next/build-manifest.json`'s `rootMainFiles` +
 * `polyfillFiles` — the framework/runtime bundle every page ships — rather than guessed
 * from chunk filename prefixes (`main-`, `webpack-`, …). Those prefixes are a webpack
 * convention; Next.js 16 builds with Turbopack by default, whose chunk filenames are
 * content-hashed with no fixed prefix (verified 2026-09-02: a Turbopack build here
 * produced names like `41xeasxlqwbwi.js`, `turbopack-0f5axy1b8s5jj.js`), so a
 * prefix-based filter silently matches nothing and reports a false "0 kB, within budget"
 * pass. Reading the manifest itself works under either bundler. This still only measures
 * the shared framework/runtime bundle, not the per-route App Router client bundle — Next
 * doesn't expose a small, stable manifest field for that yet; tighten this if the app
 * grows a client component large enough for that gap to matter.
 *
 * Run after `pnpm build` as `tsx scripts/bundle-budget.ts`.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.next');

// 250 kB gzipped initial JS budget.  The number is intentionally conservative — Next.js
// SSR pages ship very little client-side JS.  Raise it only with justification in the PR.
const INITIAL_JS_BUDGET_BYTES = 250 * 1024;

// Artefacts that must NEVER appear in the bundle (would block initial load and leak sizes)
const FORBIDDEN_EXTENSIONS = ['.zkey', '.wasm'];

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

async function main(): Promise<void> {
  // Verify the build exists
  try {
    await stat(buildDir);
  } catch {
    console.error('❌  .next/ not found. Run `pnpm build` first.');
    process.exit(1);
  }

  const staticChunksDir = path.join(buildDir, 'static', 'chunks');
  let exists = false;
  try {
    await stat(staticChunksDir);
    exists = true;
  } catch {
    // no chunks dir means trivial build — that's fine
  }

  if (!exists) {
    console.log('✅  No static chunks directory found (trivial build — budget OK).');
    process.exit(0);
  }

  const allFiles = await walk(staticChunksDir);

  // Check for forbidden artefacts
  const forbidden = allFiles.filter((f) => FORBIDDEN_EXTENSIONS.some((ext) => f.endsWith(ext)));
  if (forbidden.length > 0) {
    console.error('❌  Proving artefacts found in the JS bundle. These must be loaded lazily:');
    for (const f of forbidden) {
      console.error('   ', path.relative(root, f));
    }
    process.exit(1);
  }

  // Sum initial JS: the framework/runtime files Next.js's own build manifest says every
  // page loads. See the file header for why this reads the manifest instead of guessing
  // filenames.
  const manifestPath = path.join(buildDir, 'build-manifest.json');
  let manifest: { rootMainFiles?: string[]; polyfillFiles?: string[] };
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as typeof manifest;
  } catch (err) {
    console.error(
      `❌  Could not read or parse ${path.relative(root, manifestPath)}: ${String(err)}`,
    );
    process.exit(1);
  }

  const initialFiles = [...(manifest.rootMainFiles ?? []), ...(manifest.polyfillFiles ?? [])];
  let totalInitial = 0;
  const counted: string[] = [];

  // Budget is stated in gzipped bytes (what the browser actually downloads over the wire,
  // since every static asset Next.js serves is gzip/brotli-compressed) — measure that, not
  // raw on-disk size, or every check silently compares the wrong unit.
  for (const relFile of initialFiles) {
    const file = path.join(buildDir, relFile);
    const raw = await readFile(file);
    const gzipped = gzipSync(raw).byteLength;
    totalInitial += gzipped;
    counted.push(`  ${(gzipped / 1024).toFixed(1)} kB gz  ${path.relative(root, file)}`);
  }

  const overBudget = totalInitial > INITIAL_JS_BUDGET_BYTES;

  console.log('\nInitial JS chunks:');
  for (const line of counted) console.log(line);
  console.log(
    `\nTotal: ${(totalInitial / 1024).toFixed(1)} kB gz  /  budget: ${INITIAL_JS_BUDGET_BYTES / 1024} kB gz`,
  );

  if (overBudget) {
    console.error(
      `\n❌  Initial JS bundle (${(totalInitial / 1024).toFixed(1)} kB gz) exceeds ${INITIAL_JS_BUDGET_BYTES / 1024} kB gz budget.`,
    );
    console.error(
      '   Audit your imports. Proving artefacts and crypto libraries must be loaded lazily.',
    );
    process.exit(1);
  }

  console.log('\n✅  Bundle size within budget.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
