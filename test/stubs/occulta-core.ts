/**
 * Test-only resolution target for `@occulta/core`, which isn't installable yet (see
 * lib/occulta.ts). vitest.config.ts aliases the bare specifier here so Vite can resolve the
 * import; tests then replace it with `vi.mock('@occulta/core', ...)`. Anything that reaches
 * this file unmocked fails loudly instead of running against fake cryptography.
 */
export function buildOccultaPoseidon(): never {
  throw new Error('@occulta/core is not installed; mock it with vi.mock in the test.');
}
