/**
 * Regenerates the playground's dev-fixture circuit artefacts in public/fixtures/playground/.
 *
 *   CIRCOM=/path/to/circom CIRCOMLIB_PARENT=/dir/containing/circomlib \
 *   OCCULTA_CONTRACTS=../occulta-contracts pnpm fixture:playground
 *
 * Pinned toolchain: circom 2.2.2, circomlib v2.0.5 (a git checkout named `circomlib`), and
 * the snarkjs version in package.json. OCCULTA_CONTRACTS must be a checkout of
 * occulta-contracts — the Poseidon reference vectors are copied from its
 * fixtures/poseidon/*.json, with the commit recorded in the manifest.
 *
 * The trusted setup here is a SINGLE-PARTY, THROWAWAY ceremony with random entropy. Anyone
 * who ran this script could forge proofs for the circuit. That is acceptable only because
 * the circuit guards nothing; it exists so the playground can show a real Groth16 proof
 * being generated and verified before occulta-sdk publishes real circuits. The manifest
 * says so, and the playground renders that warning.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureManifestSchema } from '../lib/playground';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'poseidon_preimage';
const circuitSrc = path.join(root, 'fixtures', 'playground', `${NAME}.circom`);
const outDir = path.join(root, 'public', 'fixtures', 'playground');
const PUBLIC_BASE = '/fixtures/playground';

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Set ${name} — see the header of scripts/gen-playground-fixture.ts`);
  return value;
}

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

const snarkjsCli = path.join(root, 'node_modules', 'snarkjs', 'build', 'cli.cjs');
const snarkjs = (...args: string[]) => run(process.execPath, [snarkjsCli, ...args]);

async function describe(file: string, publicName: string) {
  const data = await readFile(file);
  return {
    path: `${PUBLIC_BASE}/${publicName}`,
    bytes: data.byteLength,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}

async function main() {
  const circom = env('CIRCOM', 'circom');
  const circomlibParent = env('CIRCOMLIB_PARENT');
  const contracts = path.resolve(root, env('OCCULTA_CONTRACTS', '../occulta-contracts'));

  const circomVersion = run(circom, ['--version']).trim();
  if (!circomVersion.includes('2.2.2')) {
    throw new Error(`Expected circom 2.2.2, got "${circomVersion}"`);
  }
  const circomlibVersion = run('git', [
    '-C',
    path.join(circomlibParent, 'circomlib'),
    'describe',
    '--tags',
  ]).trim();
  const contractsCommit = run('git', ['-C', contracts, 'rev-parse', '--short', 'HEAD']).trim();
  const snarkjsVersion = (
    JSON.parse(
      await readFile(path.join(root, 'node_modules', 'snarkjs', 'package.json'), 'utf8'),
    ) as { version: string }
  ).version;

  const work = await mkdtemp(path.join(tmpdir(), 'occulta-fixture-'));
  try {
    run(circom, [circuitSrc, '--r1cs', '--wasm', '-l', circomlibParent, '-o', work]);
    const r1cs = path.join(work, `${NAME}.r1cs`);
    const info = snarkjs('r1cs', 'info', r1cs);
    const constraintMatch = /# of Constraints:\s*(\d+)/.exec(info);
    if (!constraintMatch) throw new Error(`Could not read constraint count from:\n${info}`);
    const constraintCount = Number(constraintMatch[1]);

    const p = (f: string) => path.join(work, f);
    const entropy = () => `-e=${randomBytes(32).toString('hex')}`;
    snarkjs('powersoftau', 'new', 'bn128', '10', p('pot_0.ptau'));
    snarkjs('powersoftau', 'contribute', p('pot_0.ptau'), p('pot_1.ptau'), '--name=dev', entropy());
    snarkjs('powersoftau', 'prepare', 'phase2', p('pot_1.ptau'), p('pot_final.ptau'));

    // The setup the playground proves with…
    snarkjs('groth16', 'setup', r1cs, p('pot_final.ptau'), p('a_0.zkey'));
    snarkjs('zkey', 'contribute', p('a_0.zkey'), p('a.zkey'), '--name=dev', entropy());
    snarkjs('zkey', 'export', 'verificationkey', p('a.zkey'), p('a_vkey.json'));
    // …and an independent second setup of the same circuit, whose VK is shipped only so the
    // playground can demonstrate the "VK registered for a different setup" failure for real.
    snarkjs('groth16', 'setup', r1cs, p('pot_final.ptau'), p('b_0.zkey'));
    snarkjs('zkey', 'contribute', p('b_0.zkey'), p('b.zkey'), '--name=other', entropy());
    snarkjs('zkey', 'export', 'verificationkey', p('b.zkey'), p('b_vkey.json'));

    await mkdir(outDir, { recursive: true });
    const files: [string, string][] = [
      [path.join(work, `${NAME}_js`, `${NAME}.wasm`), `${NAME}.wasm`],
      [p('a.zkey'), `${NAME}.zkey`],
      [p('a_vkey.json'), `${NAME}.vkey.json`],
      [p('b_vkey.json'), `${NAME}.other-setup.vkey.json`],
    ];
    for (const [from, to] of files) await copyFile(from, path.join(outDir, to));

    const bn254 = JSON.parse(
      await readFile(path.join(contracts, 'fixtures', 'poseidon', 'bn254.json'), 'utf8'),
    ) as { hash2: { inputs: string[]; output: string }[] };
    const bls = JSON.parse(
      await readFile(path.join(contracts, 'fixtures', 'poseidon', 'bls12_381.json'), 'utf8'),
    ) as { t3: { inputs: string[]; output: string }[] };

    const manifest = fixtureManifestSchema.parse({
      name: NAME,
      title: 'Poseidon preimage',
      description:
        'Proves knowledge of a and b such that Poseidon(a, b) equals the public hash, bound ' +
        'to a public scope. The private inputs never leave the prover worker.',
      status: 'dev-fixture',
      curve: 'bn254',
      constraintCount,
      publicSignals: ['hash', 'scope'],
      privateInputs: ['a', 'b'],
      publicInputs: ['scope'],
      poseidonOutputSignal: 'hash',
      example: { a: '1', b: '2', scope: '42' },
      artefacts: {
        wasm: await describe(path.join(outDir, `${NAME}.wasm`), `${NAME}.wasm`),
        zkey: await describe(path.join(outDir, `${NAME}.zkey`), `${NAME}.zkey`),
        vkey: await describe(path.join(outDir, `${NAME}.vkey.json`), `${NAME}.vkey.json`),
        vkeyOtherSetup: await describe(
          path.join(outDir, `${NAME}.other-setup.vkey.json`),
          `${NAME}.other-setup.vkey.json`,
        ),
      },
      poseidonReference: {
        label: 'BN254, t=3 (circomlib parameters — what occulta-contracts hashes with)',
        source: `occulta-contracts@${contractsCommit} fixtures/poseidon/bn254.json (hash2)`,
        vectors: bn254.hash2,
      },
      poseidonForeignReference: {
        label: 'BLS12-381, t=3 (a different Poseidon parameter set)',
        source: `occulta-contracts@${contractsCommit} fixtures/poseidon/bls12_381.json (t3)`,
        vectors: bls.t3,
      },
      setup: {
        ptau: 'Fresh 2^10 powers of tau generated by this script (single contribution).',
        warning:
          'Single-party throwaway trusted setup. Whoever generated these artefacts can forge ' +
          'proofs for this circuit. Fine for a demo that guards nothing; never reuse it.',
      },
      toolchain: { circom: circomVersion, circomlib: circomlibVersion, snarkjs: snarkjsVersion },
    });
    await writeFile(path.join(outDir, `${NAME}.json`), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Wrote ${NAME} fixture: ${constraintCount} constraints → ${outDir}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
