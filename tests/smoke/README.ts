/**
 * Smoke Suite
 *
 * This file doesn't contain tests directly.
 * The @smoke tag is used inline in the spec files and the smoke
 * suite runs via: `npm run test:smoke` (playwright test --grep @smoke)
 *
 * Smoke tests cover the critical path (6 tests):
 * - Successful login                          (auth/login.spec.ts)
 * - Add item to cart                          (cart/cart.spec.ts)
 * - Added item visible in cart view           (cart/cart.spec.ts)
 * - Full checkout, end to end                 (checkout/checkout.spec.ts)
 * - Add to cart from product detail page      (product/product.spec.ts)
 * - Log out                                   (navigation/navigation.spec.ts)
 *
 * They run in seconds on CI and serve as the pre-merge release gate.
 *
 * To add a test to smoke: append @smoke to the test title string.
 * Example: test('should do critical thing @smoke', ...)
 */

export {};
