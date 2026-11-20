import { test, expect } from '../../src/fixtures';
import { USERS } from '../../src/constants/credentials';
import { CHECKOUT_INFO, PRODUCTS } from '../../src/constants/checkout';
import { ROUTES } from '../../src/constants/routes';
import { LoginPage } from '../../src/pages/LoginPage';
import { InventoryPage } from '../../src/pages/InventoryPage';
import { CartPage } from '../../src/pages/CartPage';
import { CheckoutPage } from '../../src/pages/CheckoutPage';

/**
 * User Variant Tests: "do these tests actually catch bugs?"
 *
 * SauceDemo ships deliberately broken accounts. Every check below runs
 * against all of them:
 *
 * - standard_user is the control. Every check must pass, which proves
 *   the check itself is valid.
 * - Known bugs are marked test.fail() with a description. CI stays green
 *   while the report documents each bug and the check that catches it.
 *   If SauceDemo ever fixes one, that test "unexpectedly passes" and fails
 *   the run, so the bug list can't silently go stale.
 * - performance_glitch_user must pass everything despite a ~5s login,
 *   which proves the waits are condition-based, not fixed sleeps.
 *
 * Every bug listed here was observed by exploring the live site
 * before writing tests, not taken from documentation.
 */

type User = { username: string; password: string };
type Pages = { login: LoginPage; inventory: InventoryPage; cart: CartPage; checkout: CheckoutPage; wait: { timeout: number } };

/**
 * Assertion timeouts. Working checks get a generous wait (performance_glitch_user
 * takes ~5s to sort), and only checks expected to fail use a short one, so known
 * bugs fail fast without making real checks flaky.
 */
const WORKING_WAIT = { timeout: 15_000 };
const KNOWN_BUG_WAIT = { timeout: 5_000 };
const CATALOG = Object.values(PRODUCTS);

// ── Checks ───────────────────────────────────────────────────────────────────

const CHECKS = {
  'product images load': async ({ inventory, wait }: Pages) => {
    const images = inventory.productItems.locator('img');
    await expect(images).toHaveCount(CATALOG.length);
    // "sl-404" is the app's own image-not-found placeholder
    await expect(inventory.productItems.locator('img[src*="sl-404"]')).toHaveCount(0, wait);
  },

  'prices match the catalog': async ({ inventory, wait }: Pages) => {
    for (const product of CATALOG) {
      const price = inventory.productItems.filter({ hasText: product.name }).locator('[data-test="inventory-item-price"]');
      await expect(price, `${product.name} price`).toHaveText(product.price, wait);
    }
  },

  'sort by name Z to A': async ({ inventory, wait }: Pages) => {
    const expected = CATALOG.map((p) => p.name).sort().reverse();
    await inventory.sortBy('za');
    // eslint-disable-next-line playwright/no-standalone-expect -- checks run inside test() via the matrix below
    await expect.poll(() => inventory.getProductNames(), wait).toEqual(expected);
  },

  'sort by price low to high': async ({ inventory, wait }: Pages) => {
    await inventory.sortBy('lohi');
    await expect
      .poll(async () => {
        const prices = await inventory.getProductPrices();
        // Require the full list: a partial read mid-render (1-2 items) is
        // trivially "in order" and would let a broken sort pass.
        return prices.length === CATALOG.length && prices.every((price, i) => i === 0 || prices[i - 1] <= price);
      }, { ...wait, message: `All ${CATALOG.length} prices should be in ascending order` })
      .toBe(true);
  },

  'add every product to the cart': async ({ inventory, wait }: Pages) => {
    for (const product of CATALOG) {
      await inventory.addItemToCart(product.dataTestId);
    }
    await expect(inventory.cartBadge).toHaveText(String(CATALOG.length), wait);
  },

  'remove products from the cart': async ({ inventory, wait }: Pages) => {
    for (const product of CATALOG) {
      await inventory.addItemToCart(product.dataTestId);
    }
    // Click from last to first so a successful removal never shifts the
    // index of a button we haven't clicked yet.
    const removeButtons = await inventory.productItems.locator('[data-test^="remove"]').all();
    for (const button of removeButtons.reverse()) {
      await button.click();
    }
    await expect(inventory.cartBadge).toBeHidden(wait);
  },

  'checkout form keeps typed values': async ({ inventory, cart, checkout, wait }: Pages) => {
    await inventory.addItemToCart(PRODUCTS.BACKPACK.dataTestId);
    await inventory.goToCart();
    await cart.proceedToCheckout();
    await checkout.assertOnStepOne();

    const { firstName, lastName, zipCode } = CHECKOUT_INFO.VALID;
    await checkout.fillShippingInfo(firstName, lastName, zipCode);

    await expect(checkout.firstNameInput).toHaveValue(firstName, wait);
    await expect(checkout.lastNameInput).toHaveValue(lastName, wait);
    await expect(checkout.zipCodeInput).toHaveValue(zipCode, wait);
  },

  'complete an order': async ({ inventory, cart, checkout, wait }: Pages) => {
    await inventory.addItemToCart(PRODUCTS.BACKPACK.dataTestId);
    await inventory.goToCart();
    await cart.proceedToCheckout();

    const { firstName, lastName, zipCode } = CHECKOUT_INFO.VALID;
    await checkout.fillShippingInfo(firstName, lastName, zipCode);
    await checkout.continue();
    await expect(checkout.finishButton).toBeVisible(wait);
    await checkout.finish();

    await expect(checkout.confirmationHeader).toHaveText('Thank you for your order!', wait);
    await checkout.assertPathIs(ROUTES.CHECKOUT_COMPLETE);
  },
} satisfies Record<string, (pages: Pages) => Promise<void>>;

type CheckName = keyof typeof CHECKS;

// ── Users and their known bugs (observed on the live site) ───────────────────

const USER_VARIANTS: { user: User; knownBugs: Partial<Record<CheckName, string>> }[] = [
  {
    user: USERS.STANDARD,
    knownBugs: {}, // control: every check must pass
  },
  {
    user: USERS.PROBLEM,
    knownBugs: {
      'product images load': 'every product shows the 404 placeholder image',
      'sort by name Z to A': 'sorting does nothing',
      'sort by price low to high': 'sorting does nothing',
      'add every product to the cart': 'only 3 of 6 add-to-cart buttons work',
      'remove products from the cart': 'remove buttons do nothing',
      'checkout form keeps typed values': 'typing the last name overwrites the first name field',
      'complete an order': 'blocked at step one: "Last Name is required"',
    },
  },
  {
    user: USERS.ERROR,
    knownBugs: {
      'sort by name Z to A': 'alert "Sorting is broken!" and order is unchanged',
      'sort by price low to high': 'alert "Sorting is broken!" and order is unchanged',
      'add every product to the cart': 'only 3 of 6 add-to-cart buttons work (page error)',
      'remove products from the cart': 'remove throws "Failed to remove item from cart"',
      'checkout form keeps typed values': 'last name field stays empty',
      'complete an order': 'Finish button throws a page error; order never completes',
    },
  },
  {
    user: USERS.PERFORMANCE_GLITCH,
    knownBugs: {}, // ~5s login, then fully functional: must pass with no sleeps
  },
  {
    user: USERS.VISUAL,
    knownBugs: {
      'product images load': 'Sauce Labs Backpack shows the 404 placeholder image',
      'prices match the catalog': 'prices are randomized and change on every render',
      'sort by price low to high': 'prices re-randomize, so the list is never in order',
    },
  },
];

// ── Test matrix ──────────────────────────────────────────────────────────────

for (const { user, knownBugs } of USER_VARIANTS) {
  test.describe(`User variant: ${user.username}`, () => {
    for (const [checkName, check] of Object.entries(CHECKS) as [CheckName, (pages: Pages) => Promise<void>][]) {
      const bug = knownBugs[checkName];
      const wait = bug === undefined ? WORKING_WAIT : KNOWN_BUG_WAIT;

      test(`${checkName}`, async ({ loginPage, inventoryPage, cartPage, checkoutPage }) => {
        test.fail(bug !== undefined, `Known bug for ${user.username}: ${bug}`);

        await loginPage.goto();
        await loginPage.login(user.username, user.password);
        await inventoryPage.assertOnInventoryPage();

        await check({ login: loginPage, inventory: inventoryPage, cart: cartPage, checkout: checkoutPage, wait });
      });
    }
  });
}
