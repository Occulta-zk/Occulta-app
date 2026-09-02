import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

/**
 * `eslint-config-next/core-web-vitals` already bundles typescript-eslint, eslint-plugin-react,
 * react-hooks, eslint-plugin-import, and jsx-a11y (verified in node_modules/eslint-config-next
 * — see its dist/index.js requires) — accessibility linting (build spec §7) comes from that,
 * not a separately-added plugin.
 */
export default [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'public/**',
    ],
  },
  ...nextCoreWebVitals,
  {
    rules: {
      // The whole point of app/api/ is that it stays empty of secret-handling code
      // (SECURITY.md #1) — console usage elsewhere is a smell that something is about
      // to log a value it shouldn't (build spec §5.5: "errors never echo secrets").
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
];
