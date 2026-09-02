/**
 * Reads `deployments/testnet.json` — the single source of truth for contract IDs, VK
 * hashes, and circuit versions (build spec §2, §12). Nothing in this app hardcodes a
 * contract ID or a VK hash; every call site goes through this module.
 *
 * This mirrors `occulta-sdk/deployments/schema.json` field-for-field. If the SDK's
 * schema changes, update the zod schema below to match — don't let it drift silently.
 */
import { z } from 'zod';

const circuitEntrySchema = z.object({
  version: z.string(),
  vkHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  constraintCount: z.number().int().nonnegative(),
  curve: z.enum(['bn254', 'bls12_381']).default('bn254'),
});

const contractEntrySchema = z.object({
  contractId: z.string().regex(/^C[A-Z2-7]{55}$/),
  wasmHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
});

export const deploymentManifestSchema = z.object({
  network: z.enum(['testnet', 'futurenet', 'local']),
  generatedAt: z.string().optional(),
  note: z.string().optional(),
  circuits: z.record(z.string(), circuitEntrySchema),
  contracts: z.record(z.string(), contractEntrySchema),
});

export type DeploymentManifest = z.infer<typeof deploymentManifestSchema>;
export type CircuitDeployment = z.infer<typeof circuitEntrySchema>;
export type ContractDeployment = z.infer<typeof contractEntrySchema>;

/**
 * Fetches and validates the deployment manifest. Throws rather than returning a
 * best-guess default — proving against the wrong VK, or submitting to the wrong
 * contract ID, is exactly the failure mode this file exists to prevent (build spec §2).
 */
export async function loadDeploymentManifest(
  url = process.env.NEXT_PUBLIC_DEPLOYMENTS_URL ?? '/deployments/testnet.json',
): Promise<DeploymentManifest> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load deployment manifest from ${url}: HTTP ${response.status}`);
  }
  const json: unknown = await response.json();
  return deploymentManifestSchema.parse(json);
}

/** True once at least one contract has been deployed. Drives the landing page's honest
 * "nothing is live yet" vs. "try it now" state — never claim a working demo that isn't. */
export function hasAnyDeployment(manifest: DeploymentManifest): boolean {
  return Object.keys(manifest.contracts).length > 0;
}

export function getContract(
  manifest: DeploymentManifest,
  name: string,
): ContractDeployment | undefined {
  return manifest.contracts[name];
}

export function getCircuit(
  manifest: DeploymentManifest,
  name: string,
): CircuitDeployment | undefined {
  return manifest.circuits[name];
}
