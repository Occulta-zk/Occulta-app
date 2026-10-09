/**
 * Mirrors occulta-sdk's deployments/testnet.json into public/deployments/testnet.json, the
 * file the app reads contract IDs from. The SDK's copy is the source of truth; never hand-edit
 * the mirror.
 *
 *   pnpm deployments:sync            # fetch from occulta-sdk main on GitHub
 *   pnpm deployments:sync ../occulta-sdk/deployments/testnet.json
 *   pnpm deployments:check [source]  # exit 1 if the mirror has drifted
 *
 * The source is validated against lib/deployments.ts's schema before anything is written, so
 * a malformed manifest can't reach the app.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deploymentManifestSchema } from '../lib/deployments';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = path.join(root, 'public', 'deployments', 'testnet.json');
const DEFAULT_SOURCE =
  'https://raw.githubusercontent.com/Occulta-zk/occulta-sdk/main/deployments/testnet.json';

async function readSource(source: string): Promise<string> {
  if (/^https:\/\//.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`GET ${source} → HTTP ${response.status}`);
    return response.text();
  }
  return readFile(path.resolve(source), 'utf8');
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const source = args.find((a) => a !== '--check') ?? DEFAULT_SOURCE;

  const upstream = deploymentManifestSchema.parse(JSON.parse(await readSource(source)));
  const current = deploymentManifestSchema.parse(JSON.parse(await readFile(MIRROR, 'utf8')));

  // `note` is free text and the mirror's says where it came from, so compare only the fields
  // the app acts on.
  const strip = ({ note: _note, ...rest }: typeof upstream) => JSON.stringify(rest);
  const drifted = strip(upstream) !== strip(current);

  if (check) {
    if (drifted) {
      console.error(`public/deployments/testnet.json has drifted from ${source}.`);
      process.exit(1);
    }
    console.warn(`public/deployments/testnet.json matches ${source}.`);
    return;
  }

  const mirrored = {
    $schema: './schema.json',
    ...upstream,
    note:
      `Mirrored from occulta-sdk/deployments/testnet.json by scripts/sync-deployments.ts. ` +
      `Do not hand-edit.${upstream.note ? ` Upstream note: ${upstream.note}` : ''}`,
  };
  await writeFile(MIRROR, JSON.stringify(mirrored, null, 2) + '\n');
  console.warn(drifted ? `Updated the mirror from ${source}.` : 'Mirror already up to date.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
