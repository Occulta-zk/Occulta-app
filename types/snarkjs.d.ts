/**
 * snarkjs@0.7.6 ships no TypeScript declarations (no `.d.ts` files, no `types` field in its
 * package.json — verified 2026-09-02 against the installed package). This ambient
 * declaration covers only the surface `workers/prover.worker.ts` actually calls.
 *
 * This mirrors `occulta-sdk/packages/core/src/types/snarkjs.d.ts` exactly — that file is the
 * verified source (checked live against snarkjs@0.7.6's own source: src/groth16_prove.js,
 * src/groth16.js, src/wtns_utils.js). Keep the two in sync; do not diverge without a fresh
 * verification note.
 */

declare module 'snarkjs' {
  /**
   * snarkjs uses "file" objects that can be either a path string or an in-memory buffer.
   * For the in-memory path (what this app uses to avoid temp files in a Web Worker), the
   * shape is `{type:'mem', data:Uint8Array}` — verified live 2026-09-02 against
   * wtns_utils.js and the binFileUtils.readBinFile path in snarkjs@0.7.6.
   */
  type SnarkjsFileInput = string | { type: 'mem'; data: Uint8Array };

  /** A snarkjs logger (subset of the standard logger interface). */
  interface SnarkjsLogger {
    debug?(msg: string): void;
    info?(msg: string): void;
    warn?(msg: string): void;
    error?(msg: string): void;
  }

  /** A snarkjs-shaped G1 point: `[x, y, z]` as decimal strings. */
  type G1 = [string, string, string];

  /** A snarkjs-shaped G2 point: `[[x0,x1],[y0,y1],[z0,z1]]` as decimal strings. */
  type G2 = [[string, string], [string, string], [string, string]];

  interface SnarkjsVKey {
    readonly protocol: string;
    readonly curve: string;
    readonly nPublic: number;
    readonly vk_alpha_1: G1;
    readonly vk_beta_2: G2;
    readonly vk_gamma_2: G2;
    readonly vk_delta_2: G2;
    readonly IC: readonly G1[];
  }

  interface SnarkjsProof {
    readonly protocol: string;
    readonly curve: string;
    readonly pi_a: G1;
    readonly pi_b: G2;
    readonly pi_c: G1;
  }

  interface FullProveResult {
    readonly proof: SnarkjsProof;
    readonly publicSignals: string[];
  }

  export const groth16: {
    /**
     * Generates a Groth16 proof, computing the witness internally.
     * Verified live 2026-09-02 against snarkjs@0.7.6 src/groth16_prove.js.
     */
    fullProve(
      input: Record<string, unknown>,
      wasmFile: SnarkjsFileInput,
      zkeyFileName: SnarkjsFileInput,
      logger?: SnarkjsLogger,
      wtnsCalcOptions?: Record<string, unknown>,
      proverOptions?: Record<string, unknown>,
    ): Promise<FullProveResult>;

    /**
     * Verifies a Groth16 proof. Returns true if valid.
     * Verified live 2026-09-02 against snarkjs@0.7.6 src/groth16.js.
     */
    verify(
      vk: SnarkjsVKey,
      publicSignals: string[],
      proof: SnarkjsProof,
      logger?: SnarkjsLogger,
    ): Promise<boolean>;
  };
}
