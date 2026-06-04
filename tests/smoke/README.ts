/**
 * Smoke Suite
 *
 * This file doesn't contain tests directly.
 * The @smoke tag is used inline in test files (login.spec.ts, cart.spec.ts)
 * and the smoke suite runs via: `playwright test --grep @smoke`
 *
 * Smoke tests cover:
 * - Successful login
 * - Add item to cart
 * - Cart item visible in cart view
 *
 * These are the three flows a CTO wants green before every deploy.
 * They run in < 30 seconds on CI and serve as the release gate.
 *
 * To add a test to smoke: append @smoke to the test title string.
 * Example: test('should do critical thing @smoke', ...)
 */

export {};
