// @vitest-environment node
/**
 * Playground: input validation, the failure-mode classifier, and — against the committed
 * dev-fixture artefacts — a real Groth16 proof generated and verified end to end, with each
 * named failure mode reproduced for real rather than simulated.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as snarkjs from 'snarkjs';
import type { SnarkjsProof, SnarkjsVKey } from 'snarkjs';
import {
  BN254_FR_MODULUS,
  checkPoseidonOutput,
  diagnoseVerification,
  fixtureManifestSchema,
  validateInputs,
  type FixtureManifest,
} from '@/lib/playground';

const publicDir = path.resolve(__dirname, '..', 'public');
const readPublic = (p: string) => readFile(path.join(publicDir, p));

describe('validateInputs', () => {
  it('accepts canonical decimal field elements', () => {
    expect(validateInputs(['a'], { a: '0' })).toEqual({});
    expect(validateInputs(['a'], { a: (BN254_FR_MODULUS - 1n).toString() })).toEqual({});
  });

  it('rejects empty, non-decimal, and out-of-field values without echoing them', () => {
    const secret = '0x' + 'ab'.repeat(30);
    const errors = validateInputs(['a', 'b', 'c'], {
      a: '',
      b: secret,
      c: BN254_FR_MODULUS.toString(),
    });
    expect(Object.keys(errors).sort()).toEqual(['a', 'b', 'c']);
    for (const message of Object.values(errors)) expect(message).not.toContain('ab'.repeat(30));
  });
});

describe('diagnoseVerification (classifier logic)', () => {
  const truth = ['111', '222', '333'];
  const verifyOnly = (expected: string[]) => async (signals: string[]) =>
    signals.join() === expected.join();

  it('reports success without searching', async () => {
    expect(await diagnoseVerification({ nPublic: 3 }, truth, verifyOnly(truth))).toEqual({
      kind: 'verified',
    });
  });

  it('names a public-signal order mismatch and the order that works', async () => {
    const submitted = ['333', '111', '222'];
    const d = await diagnoseVerification({ nPublic: 3 }, submitted, verifyOnly(truth));
    expect(d.kind).toBe('signal-order-mismatch');
    if (d.kind !== 'signal-order-mismatch') return;
    expect(d.correctOrder.map((i) => submitted[i])).toEqual(truth);
  });

  it('names a VK for a different circuit when the public-signal count differs', async () => {
    let calls = 0;
    const d = await diagnoseVerification({ nPublic: 2 }, truth, async () => {
      calls++;
      return true;
    });
    expect(d).toMatchObject({ kind: 'vk-mismatch', reason: 'public-count' });
    expect(calls).toBe(0);
  });

  it('names a VK mismatch when no ordering verifies', async () => {
    const d = await diagnoseVerification({ nPublic: 3 }, truth, async () => false);
    expect(d).toMatchObject({ kind: 'vk-mismatch', reason: 'no-ordering-verifies' });
  });
});

describe('checkPoseidonOutput', () => {
  const reference = {
    label: 'ref',
    source: 'test',
    vectors: [{ inputs: ['1', '2'], output: '0x' + '0'.repeat(63) + 'f' }],
  };

  it('matches, mismatches, or reports no vector', () => {
    expect(checkPoseidonOutput(reference, ['1', '2'], '15').kind).toBe('match');
    expect(checkPoseidonOutput(reference, ['01', '2'], '15').kind).toBe('match');
    expect(checkPoseidonOutput(reference, ['1', '2'], '16')).toMatchObject({
      kind: 'mismatch',
      expected: 15n,
      actual: 16n,
    });
    expect(checkPoseidonOutput(reference, ['3', '4'], '15').kind).toBe('no-vector');
  });
});

describe('dev-fixture circuit, proved and verified for real', () => {
  let manifest: FixtureManifest;
  let vkey: SnarkjsVKey;
  let otherVkey: SnarkjsVKey;
  let proof: SnarkjsProof;
  let publicSignals: string[];

  beforeAll(async () => {
    manifest = fixtureManifestSchema.parse(
      JSON.parse((await readPublic('fixtures/playground/poseidon_preimage.json')).toString()),
    );
    const local = (p: string) => p.replace(/^\//, '');
    vkey = JSON.parse((await readPublic(local(manifest.artefacts.vkey.path))).toString());
    otherVkey = JSON.parse(
      (await readPublic(local(manifest.artefacts.vkeyOtherSetup.path))).toString(),
    );
    const wasm = new Uint8Array(await readPublic(local(manifest.artefacts.wasm.path)));
    const zkey = new Uint8Array(await readPublic(local(manifest.artefacts.zkey.path)));
    ({ proof, publicSignals } = await snarkjs.groth16.fullProve(
      manifest.example,
      { type: 'mem', data: wasm },
      { type: 'mem', data: zkey },
    ));
  }, 60_000);

  const verifyWith = (vk: SnarkjsVKey) => (signals: string[]) =>
    snarkjs.groth16.verify(vk, signals, proof);

  it('manifest sizes match the committed files', async () => {
    for (const artefact of Object.values(manifest.artefacts)) {
      const data = await readPublic(artefact.path.replace(/^\//, ''));
      expect(data.byteLength).toBe(artefact.bytes);
    }
  });

  it('produces public signals in the declared order: [hash, scope]', () => {
    expect(publicSignals).toHaveLength(manifest.publicSignals.length);
    expect(publicSignals[manifest.publicSignals.indexOf('scope')]).toBe(manifest.example.scope);
  });

  it('verifies against its own VK', async () => {
    expect(await diagnoseVerification(vkey, publicSignals, verifyWith(vkey))).toEqual({
      kind: 'verified',
    });
  }, 30_000);

  it('detects a swapped public-signal order', async () => {
    const swapped = [...publicSignals].reverse();
    const d = await diagnoseVerification(vkey, swapped, verifyWith(vkey));
    expect(d).toEqual({ kind: 'signal-order-mismatch', correctOrder: [1, 0] });
  }, 30_000);

  it('detects a VK from a different setup of the same circuit', async () => {
    const d = await diagnoseVerification(otherVkey, publicSignals, verifyWith(otherVkey));
    expect(d).toMatchObject({ kind: 'vk-mismatch', reason: 'no-ordering-verifies' });
  }, 30_000);

  it("matches occulta-contracts' BN254 Poseidon vector and not the BLS12-381 one", () => {
    const hash = publicSignals[manifest.publicSignals.indexOf(manifest.poseidonOutputSignal)]!;
    const inputs = manifest.privateInputs.map((n) => manifest.example[n]!);
    expect(checkPoseidonOutput(manifest.poseidonReference, inputs, hash).kind).toBe('match');
    expect(checkPoseidonOutput(manifest.poseidonForeignReference, inputs, hash).kind).toBe(
      'mismatch',
    );
  });
});
