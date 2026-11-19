/**
 * ESLint config: tuned for test reliability, not just style.
 *
 * - no-floating-promises: a missing `await` on a Playwright call is the
 *   most common source of flaky tests. This makes it a lint error.
 * - playwright/no-wait-for-timeout: bans hard sleeps (page.waitForTimeout).
 * - playwright/no-focused-test, no-skipped-test: keep test.only / test.skip
 *   out of main.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:playwright/recommended',
  ],
  rules: {
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/await-thenable': 'error',
    'playwright/no-wait-for-timeout': 'error',
    'playwright/no-focused-test': 'error',
    'playwright/no-skipped-test': 'error',
    // Assertions live in page objects (assertX methods), so tests
    // legitimately contain no direct expect() calls.
    'playwright/expect-expect': 'off',
  },
  ignorePatterns: ['node_modules/', 'reports/', 'dist/', '.eslintrc.cjs'],
};
