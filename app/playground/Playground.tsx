'use client';

/**
 * The playground: load a circuit → collect inputs → prove in the worker → verify locally →
 * (verify on-chain) → show the numbers that decide whether a circuit is viable.
 *
 * Privacy: witness inputs live in this component's state and are posted to
 * workers/prover.worker.ts by structured clone. They are never put in a URL, never sent to
 * a server, never logged, and never rendered back after proving. The only network requests
 * this route makes are same-origin GETs for the circuit artefacts and the deployment
 * manifest — test/network-egress.test.ts asserts that.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { SnarkjsProof } from 'snarkjs';
import { Banner, Button, Card } from '@/components/ui';
// Imported directly, not via the barrel: the barrel's AnonymitySetBadge pulls in
// lib/occulta.ts, whose @occulta/core import can't be bundled until the SDK is installable.
import { ProgressPanel, type ProverPhase } from '@/components/proving/ProgressPanel';
import { getContract, loadDeploymentManifest, type DeploymentManifest } from '@/lib/deployments';
import {
  checkPoseidonOutput,
  formatBytes,
  formatMs,
  loadFixtureManifest,
  validateInputs,
  type Diagnosis,
  type FixtureManifest,
  type InputErrors,
  type PoseidonCheck,
} from '@/lib/playground';
import styles from './playground.module.css';

const SOURCE_URL =
  'https://github.com/Occulta-zk/occulta-app/blob/main/fixtures/playground/poseidon_preimage.circom';

interface ProofResult {
  proof: SnarkjsProof;
  publicSignals: string[];
  provingTimeMs: number;
  totalTimeMs: number;
  wasmBytes: number;
  zkeyBytes: number;
  /** Inputs to the Poseidon gadget, kept only for the reference-vector comparison. */
  poseidonInputs: string[];
}

interface Verification {
  diagnosis: Diagnosis;
  verifyTimeMs: number;
  /** Set when this result came from a deliberately injected fault. */
  fault?: string;
}

type WorkerReply =
  | { type: 'downloading'; progress: number; totalBytes: number }
  | { type: 'compiling'; phase: string }
  | { type: 'proving'; phase: string; estimatedMs: number }
  | {
      type: 'done';
      proof: SnarkjsProof;
      publicSignals: string[];
      provingTimeMs: number;
      totalTimeMs: number;
      wasmBytes: number;
      zkeyBytes: number;
    }
  | { type: 'verified'; diagnosis: Diagnosis; verifyTimeMs: number }
  | { type: 'error'; message: string }
  | { type: 'cancelled' };

export function Playground() {
  const [fixture, setFixture] = useState<FixtureManifest | null>(null);
  const [fixtureError, setFixtureError] = useState<string | null>(null);
  const [deployments, setDeployments] = useState<DeploymentManifest | null>(null);
  const [deploymentsError, setDeploymentsError] = useState<string | null>(null);

  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [inputErrors, setInputErrors] = useState<InputErrors>({});

  const [phase, setPhase] = useState<ProverPhase>('idle');
  const [phaseLabel, setPhaseLabel] = useState<string>();
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadTotal, setDownloadTotal] = useState(0);
  const [estimatedMs, setEstimatedMs] = useState<number>();
  const [runError, setRunError] = useState<string | null>(null);

  const [result, setResult] = useState<ProofResult | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [baselineVerifyMs, setBaselineVerifyMs] = useState<number | null>(null);
  const [poseidon, setPoseidon] = useState<{ check: PoseidonCheck; fault?: string } | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const pendingFault = useRef<string | undefined>(undefined);
  const pendingInputs = useRef<string[]>([]);

  useEffect(() => {
    loadFixtureManifest()
      .then((m) => {
        setFixture(m);
        setInputs(m.example);
      })
      .catch((err: unknown) => setFixtureError(errorText(err)));
    loadDeploymentManifest()
      .then(setDeployments)
      .catch((err: unknown) => setDeploymentsError(errorText(err)));
    return () => workerRef.current?.terminate();
  }, []);

  const onWorkerMessage = useCallback(
    (event: MessageEvent<WorkerReply>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'downloading':
          setPhase('downloading');
          setDownloadTotal(msg.totalBytes);
          setDownloadProgress(msg.totalBytes > 0 ? msg.progress / msg.totalBytes : 0);
          break;
        case 'compiling':
          setPhase('compiling');
          setPhaseLabel(msg.phase);
          break;
        case 'proving':
          setPhase('proving');
          setPhaseLabel(msg.phase);
          setEstimatedMs(msg.estimatedMs);
          break;
        case 'done': {
          setResult({ ...msg, poseidonInputs: pendingInputs.current });
          if (fixture) {
            const hash =
              msg.publicSignals[fixture.publicSignals.indexOf(fixture.poseidonOutputSignal)];
            setPoseidon(
              hash === undefined
                ? null
                : {
                    check: checkPoseidonOutput(
                      fixture.poseidonReference,
                      pendingInputs.current,
                      hash,
                    ),
                  },
            );
            startVerify(fixture.artefacts.vkey.path, msg.proof, msg.publicSignals);
          }
          break;
        }
        case 'verified':
          setVerification({
            diagnosis: msg.diagnosis,
            verifyTimeMs: msg.verifyTimeMs,
            fault: pendingFault.current,
          });
          // The metric reports the honest run only; injected faults don't overwrite it.
          if (!pendingFault.current) setBaselineVerifyMs(msg.verifyTimeMs);
          setPhase('done');
          setPhaseLabel(undefined);
          break;
        case 'error':
          setRunError(msg.message);
          setPhase('error');
          break;
        case 'cancelled':
          setPhase('cancelled');
          break;
      }
    },
    // startVerify is stable (only touches refs and setters); fixture is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fixture],
  );

  function getWorker(): Worker {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('../../workers/prover.worker.ts', import.meta.url), {
        type: 'module',
      });
    }
    workerRef.current.onmessage = onWorkerMessage;
    return workerRef.current;
  }

  function startVerify(vkeyUrl: string, proof: SnarkjsProof, publicSignals: string[]) {
    setPhase('verifying');
    setPhaseLabel('Checking the proof against the verification key…');
    getWorker().postMessage({ type: 'verify', vkeyUrl, proof, publicSignals });
  }

  function onProve(event: FormEvent) {
    event.preventDefault();
    if (!fixture) return;
    const names = [...fixture.privateInputs, ...fixture.publicInputs];
    const errors = validateInputs(names, inputs);
    setInputErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setResult(null);
    setVerification(null);
    setBaselineVerifyMs(null);
    setPoseidon(null);
    setRunError(null);
    setDownloadProgress(0);
    setEstimatedMs(undefined);
    pendingFault.current = undefined;
    pendingInputs.current = fixture.privateInputs.map((n) => inputs[n]!.trim());

    setPhase('compiling');
    setPhaseLabel('Starting the prover worker…');
    getWorker().postMessage({
      type: 'prove',
      circuitName: fixture.name,
      wasmUrl: fixture.artefacts.wasm.path,
      zkeyUrl: fixture.artefacts.zkey.path,
      inputs: Object.fromEntries(names.map((n) => [n, inputs[n]!.trim()])),
      constraintCount: fixture.constraintCount,
    });
  }

  function onCancel() {
    // snarkjs can't be interrupted mid-proof, so cancelling means killing the worker.
    workerRef.current?.terminate();
    workerRef.current = null;
    setPhase('cancelled');
    setPhaseLabel(undefined);
  }

  function injectSignalSwap() {
    if (!fixture || !result) return;
    pendingFault.current = 'Public signals submitted in reverse order';
    startVerify(fixture.artefacts.vkey.path, result.proof, [...result.publicSignals].reverse());
  }

  function injectOtherVk() {
    if (!fixture || !result) return;
    pendingFault.current = 'Verified against the VK from an independent setup of this circuit';
    startVerify(fixture.artefacts.vkeyOtherSetup.path, result.proof, result.publicSignals);
  }

  function injectForeignPoseidon() {
    if (!fixture || !result) return;
    const hash = result.publicSignals[fixture.publicSignals.indexOf(fixture.poseidonOutputSignal)];
    if (hash === undefined) return;
    setPoseidon({
      check: checkPoseidonOutput(fixture.poseidonForeignReference, result.poseidonInputs, hash),
      fault: 'Compared against a contract that hashes with BLS12-381 Poseidon parameters',
    });
  }

  if (fixtureError) {
    return (
      <Banner variant="danger" title="The playground circuit could not be loaded">
        {fixtureError}
      </Banner>
    );
  }
  if (!fixture) {
    return <p className={styles.muted}>Loading the circuit…</p>;
  }

  const busy =
    phase === 'downloading' ||
    phase === 'compiling' ||
    phase === 'proving' ||
    phase === 'verifying';
  const registry = deployments ? getContract(deployments, 'registry') : undefined;
  const artefactBytes = fixture.artefacts.wasm.bytes + fixture.artefacts.zkey.bytes;

  return (
    <div className={styles.layout}>
      <Banner variant="warning" title="Development fixture, not an Occulta circuit">
        {fixture.setup.warning} The real circuits will come from <code>occulta-sdk</code>, which
        hasn&apos;t published any yet. This one is here so you can watch a real Groth16 proof get
        generated and checked in your browser today.
      </Banner>

      <Card>
        <h2 className={styles.h2}>1. Circuit: {fixture.title}</h2>
        <p>{fixture.description}</p>
        <dl className={styles.facts}>
          <div>
            <dt>Constraints</dt>
            <dd>{fixture.constraintCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Artefacts (wasm + zkey)</dt>
            <dd>{formatBytes(artefactBytes)}</dd>
          </div>
          <div>
            <dt>Public signals, in order</dt>
            <dd>
              <code>[{fixture.publicSignals.join(', ')}]</code>
            </dd>
          </div>
          <div>
            <dt>Toolchain</dt>
            <dd>
              {fixture.toolchain.circom}, circomlib {fixture.toolchain.circomlib}, snarkjs{' '}
              {fixture.toolchain.snarkjs}
            </dd>
          </div>
        </dl>
        <p className={styles.muted}>
          <a href={SOURCE_URL} rel="noreferrer">
            Read the circuit source
          </a>
          .
        </p>
      </Card>

      <Card>
        <h2 className={styles.h2}>2. Inputs</h2>
        <form onSubmit={onProve} noValidate className={styles.form}>
          <fieldset className={styles.fieldset} disabled={busy}>
            <legend>Private — sent only to the prover worker in this tab</legend>
            {fixture.privateInputs.map((name) => (
              <InputField
                key={name}
                name={name}
                value={inputs[name] ?? ''}
                error={inputErrors[name]}
                onChange={(v) => setInputs((prev) => ({ ...prev, [name]: v }))}
              />
            ))}
          </fieldset>
          <fieldset className={styles.fieldset} disabled={busy}>
            <legend>Public — becomes part of the proof</legend>
            {fixture.publicInputs.map((name) => (
              <InputField
                key={name}
                name={name}
                value={inputs[name] ?? ''}
                error={inputErrors[name]}
                onChange={(v) => setInputs((prev) => ({ ...prev, [name]: v }))}
              />
            ))}
          </fieldset>
          <div className={styles.actions}>
            <Button type="submit" disabled={busy}>
              Prove and verify
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setInputs(fixture.example);
                setInputErrors({});
              }}
            >
              Reset to example
            </Button>
          </div>
        </form>
      </Card>

      <ProgressPanel
        phase={phase}
        phaseLabel={phaseLabel}
        downloadProgress={downloadProgress}
        totalDownloadBytes={downloadTotal}
        estimatedMs={estimatedMs}
        provingTimeMs={result?.provingTimeMs}
        onCancel={onCancel}
      />

      {phase === 'error' && runError && (
        <Banner variant="danger" title="The prover reported an error" live>
          {runError}
        </Banner>
      )}

      {result && (
        <Card>
          <h2 className={styles.h2}>3. Result</h2>
          <dl className={styles.facts}>
            <div>
              <dt>Proving time</dt>
              <dd>{formatMs(result.provingTimeMs)}</dd>
            </div>
            <div>
              <dt>Total, including download</dt>
              <dd>{formatMs(result.totalTimeMs)}</dd>
            </div>
            <div>
              <dt>Local verification</dt>
              <dd>{baselineVerifyMs !== null ? formatMs(baselineVerifyMs) : '…'}</dd>
            </div>
            <div>
              <dt>Downloaded artefacts</dt>
              <dd>
                {formatBytes(result.wasmBytes)} wasm + {formatBytes(result.zkeyBytes)} zkey
              </dd>
            </div>
          </dl>
          <h3 className={styles.h3}>Public signals</h3>
          <ol className={styles.signals}>
            {result.publicSignals.map((value, i) => (
              <li key={i}>
                <span className={styles.signalName}>{fixture.publicSignals[i]}</span>{' '}
                <code className={styles.signalValue}>{value}</code>
              </li>
            ))}
          </ol>

          <div aria-live="polite" className={styles.checks}>
            {verification && (
              <DiagnosisView verification={verification} names={fixture.publicSignals} />
            )}
            {poseidon && <PoseidonView {...poseidon} />}
          </div>

          <h3 className={styles.h3}>Reproduce a failure</h3>
          <p className={styles.muted}>
            &ldquo;Verification failed&rdquo; on its own tells you nothing. Each button below breaks
            one thing for real so you can see the specific diagnosis.
          </p>
          <div className={styles.actions}>
            <Button variant="secondary" disabled={busy} onClick={injectSignalSwap}>
              Swap public-signal order
            </Button>
            <Button variant="secondary" disabled={busy} onClick={injectOtherVk}>
              Use a VK from another setup
            </Button>
            <Button variant="secondary" disabled={busy} onClick={injectForeignPoseidon}>
              Check against other Poseidon parameters
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <h2 className={styles.h2}>4. On-chain verification</h2>
        {deploymentsError ? (
          <Banner variant="danger" title="Could not read the deployment manifest">
            {deploymentsError}
          </Banner>
        ) : !deployments ? (
          <p className={styles.muted}>Reading deployments/testnet.json…</p>
        ) : !registry ? (
          <Banner variant="info" title="Not available yet: no registry is deployed">
            <code>deployments/testnet.json</code> lists no <code>registry</code> contract, so there
            is nothing on testnet to verify against. The VK registry is milestone M5 in{' '}
            <code>occulta-contracts</code>. This step will read its contract ID from that file once
            it is published; no address is hardcoded here.
            {deployments.note && (
              <span className={styles.note}>Manifest note: {deployments.note}</span>
            )}
          </Banner>
        ) : (
          <Banner variant="info" title="Registry listed, but not callable from this build">
            The manifest lists a registry at <code>{registry.contractId}</code>, but its{' '}
            <code>verify</code> interface isn&apos;t defined upstream yet, so there is no call to
            make. This step doesn&apos;t guess at one.
          </Banner>
        )}

        <h3 className={styles.h3}>Instruction budget</h3>
        <p>
          <strong>Not measured.</strong> The budget is measured by simulating the registry&apos;s
          verify call against testnet, and there is no registry to simulate yet. When there is, this
          section will show the instructions this proof&apos;s verification consumed as a share of
          the per-transaction limit.
        </p>
        <p className={styles.muted}>
          For scale: <code>occulta-contracts/docs/BUDGET.md</code> cites SDF&apos;s Privacy Pools
          prototype at about 40M instructions for one Groth16 verification, roughly 40% of the
          testnet per-transaction limit. That is a published figure, not a measurement of this
          proof.
        </p>
      </Card>
    </div>
  );
}

function InputField(props: {
  name: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const id = `input-${props.name}`;
  const errorId = `${id}-error`;
  return (
    <div className={styles.field}>
      <label htmlFor={id}>
        <code>{props.name}</code>
      </label>
      <input
        id={id}
        name={props.name}
        className={styles.input}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        value={props.value}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={props.error ? errorId : undefined}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.error && (
        <p id={errorId} className={styles.fieldError}>
          {props.error}
        </p>
      )}
    </div>
  );
}

function DiagnosisView({ verification, names }: { verification: Verification; names: string[] }) {
  const { diagnosis, fault } = verification;
  const injected = fault ? <span className={styles.note}>Injected fault: {fault}.</span> : null;

  switch (diagnosis.kind) {
    case 'verified':
      return (
        <Banner variant="info" title="Verified locally">
          The proof is valid for this verification key. {injected}
        </Banner>
      );
    case 'signal-order-mismatch': {
      const received = diagnosis.correctOrder.map(
        (_, j) => names[diagnosis.correctOrder.indexOf(j)],
      );
      return (
        <Banner variant="danger" title="Public-signal order mismatch">
          The proof itself is valid, but its public signals were supplied in the wrong order:
          expected <code>[{names.join(', ')}]</code>, received <code>[{received.join(', ')}]</code>.
          Encode signals in <code>public.json</code> order: outputs first, then public inputs in
          declaration order. {injected}
        </Banner>
      );
    }
    case 'vk-mismatch':
      return (
        <Banner variant="danger" title="Verification key is for a different circuit or setup">
          {diagnosis.detail} {injected}
        </Banner>
      );
  }
}

function PoseidonView({ check, fault }: { check: PoseidonCheck; fault?: string }) {
  const injected = fault ? <span className={styles.note}>Injected fault: {fault}.</span> : null;
  switch (check.kind) {
    case 'match':
      return (
        <Banner variant="info" title="Poseidon parameters match">
          The circuit&apos;s hash equals the published {check.reference} vector for these inputs.{' '}
          {injected}
        </Banner>
      );
    case 'mismatch':
      return (
        <Banner variant="danger" title="Poseidon parameter mismatch">
          The circuit computed <code>{check.actual.toString()}</code>, but the {check.reference}{' '}
          reference for these inputs is <code>{check.expected.toString()}</code>. A proof from this
          circuit still verifies, but its commitments would never match what the contract hashes.{' '}
          {injected}
        </Banner>
      );
    case 'no-vector':
      return (
        <Banner variant="info" title="Poseidon parameters: not checked for these inputs">
          There is no published {check.reference} vector for these inputs, and this app doesn&apos;t
          compute Poseidon itself. Use the example inputs to see the check run.
        </Banner>
      );
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}
