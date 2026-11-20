import { Page } from '@playwright/test';
import { test, expect } from '../../src/fixtures';
import { USERS } from '../../src/constants/credentials';
import { CHECKOUT_INFO, CHECKOUT_ERRORS, PRODUCTS } from '../../src/constants/checkout';
import { ROUTES } from '../../src/constants/routes';
import { LoginPage } from '../../src/pages/LoginPage';
import { InventoryPage } from '../../src/pages/InventoryPage';
import { CartPage } from '../../src/pages/CartPage';
import { CheckoutPage } from '../../src/pages/CheckoutPage';

/**
 * User Variant Tests: "do these tests actually catch bugs?"
 *
 * SauceDemo ships deliberately broken accounts. The same 8 checks run
 * against every one of them:
 *
 * - standard_user is the control. Every check must pass, which proves
 *   the check itself is valid.
 * - performance_glitch_user must also pass everything despite ~5s delays,
 *   which proves the waits are condition-based, not fixed sleeps.
 * - For each known bug, the test asserts two things:
 *     1. The normal check FAILS (it catches the bug).
 *     2. The page shows that bug's exact SIGNATURE (e.g. "first name
 *        field contains the last name").
 *   Step 2 makes the test strict: if the site goes down, a selector
 *   changes, or the bug is fixed or behaves differently, the signature
 *   no longer matches and the test fails. A bare test.fail() would
 *   accept any failure at all.
 *
 * Every bug and signature below was observed on the live site (3 runs
 * per user) before any test was written.
 */

type User = { username: string; password: string };
type Ctx = {
  page: Page;
  login: LoginPage;
  inventory: InventoryPage;
  cart: CartPage;
  checkout: CheckoutPage;
  /** Assertion timeout for this test (see WORKING_WAIT / KNOWN_BUG_WAIT). */
  wait: { timeout: number };
  /** Messages of browser dialogs (alerts) shown during the test; each is dismissed. */
  dialogs: string[];
  /** Uncaught JavaScript errors thrown by the page during the test. */
  pageErrors: string[];
};
type Check = (ctx: Ctx) => Promise<void>;

/**
 * Working checks get a generous wait (performance_glitch_user takes ~5s to
 * sort); checks expected to fail use a short one so known bugs fail fast.
 */
const WORKING_WAIT = { timeout: 15_000 };
const KNOWN_BUG_WAIT = { timeout: 5_000 };

const CATALOG = Object.values(PRODUCTS); // listed in the app's default (A-Z) order
const DEFAULT_NAMES = CATALOG.map((p) => p.name);
const DEFAULT_PRICES = CATALOG.map((p) => p.price);

/** problem_user and error_user can add these three products... */
const ADDABLE = [PRODUCTS.BACKPACK, PRODUCTS.BIKE_LIGHT, PRODUCTS.ONESIE];
/** ...but not these three. */
const NOT_ADDABLE = [PRODUCTS.BOLT_TSHIRT, PRODUCTS.FLEECE_JACKET, PRODUCTS.RED_TSHIRT];

const SORT_BROKEN_ALERT = 'Sorting is broken! This error has been reported to Backtrace.';
const ADD_FAILED_ERROR = 'Failed to add item to the cart.';
const REMOVE_FAILED_ERROR = 'Failed to remove item from cart.';
/** Thrown by error_user's last-name field handler; it's why the last name is dropped. */
const LAST_NAME_INPUT_ERROR = "Cannot read properties of undefined (reading 'value')";

const count = (list: string[], message: string) => list.filter((m) => m === message).length;

// ── Checks: assert the CORRECT behavior ──────────────────────────────────────

const CHECKS = {
  'product images load': async ({ inventory, wait }: Ctx) => {
    await expect(inventory.productItems.locator('img')).toHaveCount(CATALOG.length);
    // "sl-404" is the app's own image-not-found placeholder
    await expect(inventory.productItems.locator('img[src*="sl-404"]')).toHaveCount(0, wait);
  },

  'prices match the catalog': async ({ inventory, wait }: Ctx) => {
    for (const product of CATALOG) {
      const price = inventory.productItems.filter({ hasText: product.name }).locator('[data-test="inventory-item-price"]');
      await expect(price, `${product.name} price`).toHaveText(product.price, wait);
    }
  },

  'sort by name Z to A': async ({ inventory, wait }: Ctx) => {
    const expected = [...DEFAULT_NAMES].sort().reverse();
    await inventory.sortBy('za');
    // eslint-disable-next-line playwright/no-standalone-expect -- checks run inside test() via the matrix below
    await expect.poll(() => inventory.getProductNames(), wait).toEqual(expected);
  },

  'sort by price low to high': async ({ inventory, wait }: Ctx) => {
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

  'add every product to the cart': async ({ inventory, wait }: Ctx) => {
    for (const product of CATALOG) {
      await inventory.addItemToCart(product.dataTestId);
    }
    await expect(inventory.cartBadge).toHaveText(String(CATALOG.length), wait);
  },

  'remove products from the cart': async ({ inventory, wait }: Ctx) => {
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

  'checkout form keeps typed values': async ({ inventory, cart, checkout, wait }: Ctx) => {
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

  'complete an order': async ({ inventory, cart, checkout, wait }: Ctx) => {
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
} satisfies Record<string, Check>;

type CheckName = keyof typeof CHECKS;

// ── Bug signatures: assert the EXACT broken behavior ─────────────────────────
// Each runs right after its check has failed, on the same page.

/** Products a buggy add/remove left in the cart: exactly the ADDABLE three. */
async function expectOnlyAddableInCart({ inventory }: Ctx): Promise<void> {
  for (const product of ADDABLE) {
    await expect(inventory.getRemoveButton(product.dataTestId), `${product.name} should be in the cart`).toBeVisible();
  }
  for (const product of NOT_ADDABLE) {
    await expect(inventory.getAddToCartButton(product.dataTestId), `${product.name} should NOT be in the cart`).toBeVisible();
  }
  await expect(inventory.cartBadge).toHaveText(String(ADDABLE.length));
}

/** Sort was ignored: names and prices are still in the default order. */
async function expectDefaultOrder({ inventory }: Ctx): Promise<void> {
  expect(await inventory.getProductNames(), 'Product order should be unchanged').toEqual(DEFAULT_NAMES);
  expect(await inventory.productPrices.allTextContents(), 'Prices should be unchanged').toEqual(DEFAULT_PRICES);
}

/** visual_user: prices are random and re-randomize on every render. */
async function expectRandomizedPrices({ page, inventory }: Ctx): Promise<void> {
  const before = await inventory.productPrices.allTextContents();
  await page.reload();
  await inventory.assertOnInventoryPage();
  const after = await inventory.productPrices.allTextContents();
  expect(before, 'Prices should not match the catalog').not.toEqual(DEFAULT_PRICES);
  expect(after, 'Prices should change on reload').not.toEqual(before);
}

const SIGNATURES = {
  problem: {
    'product images load': async ({ inventory }: Ctx) => {
      await expect(inventory.productItems.locator('img[src*="sl-404"]')).toHaveCount(CATALOG.length);
    },
    sortIgnoredSilently: async (ctx: Ctx) => {
      await expectDefaultOrder(ctx);
      expect(ctx.dialogs, 'problem_user fails silently: no alert').toEqual([]);
    },
    addFailsSilently: async (ctx: Ctx) => {
      await expectOnlyAddableInCart(ctx);
      expect(ctx.pageErrors, 'problem_user fails silently: no page errors').toEqual([]);
    },
    'checkout form keeps typed values': async ({ checkout }: Ctx) => {
      // Typing the last name overwrites the first name field
      await expect(checkout.firstNameInput).toHaveValue(CHECKOUT_INFO.VALID.lastName);
      await expect(checkout.lastNameInput).toHaveValue('');
      await expect(checkout.zipCodeInput).toHaveValue(CHECKOUT_INFO.VALID.zipCode);
    },
    'complete an order': async ({ checkout }: Ctx) => {
      // Blocked on step one by the form bug above
      await checkout.assertPathIs(ROUTES.CHECKOUT_STEP_ONE);
      await checkout.assertErrorMessage(CHECKOUT_ERRORS.MISSING_LAST_NAME);
    },
  },
  error: {
    sortIgnoredWithAlert: async (ctx: Ctx) => {
      await expectDefaultOrder(ctx);
      expect(ctx.dialogs).toEqual([SORT_BROKEN_ALERT]);
    },
    'add every product to the cart': async (ctx: Ctx) => {
      await expectOnlyAddableInCart(ctx);
      expect(count(ctx.pageErrors, ADD_FAILED_ERROR), 'one error per failed add').toBe(NOT_ADDABLE.length);
    },
    'remove products from the cart': async (ctx: Ctx) => {
      await expectOnlyAddableInCart(ctx);
      expect(count(ctx.pageErrors, ADD_FAILED_ERROR), 'one error per failed add').toBe(NOT_ADDABLE.length);
      expect(count(ctx.pageErrors, REMOVE_FAILED_ERROR), 'one error per failed remove').toBe(ADDABLE.length);
    },
    'checkout form keeps typed values': async ({ checkout, pageErrors }: Ctx) => {
      // Last name is dropped because its input handler throws (first name is fine, unlike problem_user)
      await expect(checkout.firstNameInput).toHaveValue(CHECKOUT_INFO.VALID.firstName);
      await expect(checkout.lastNameInput).toHaveValue('');
      await expect(checkout.zipCodeInput).toHaveValue(CHECKOUT_INFO.VALID.zipCode);
      expect(pageErrors, 'Only the last-name handler should throw').toEqual([LAST_NAME_INPUT_ERROR]);
    },
    'complete an order': async ({ checkout, pageErrors }: Ctx) => {
      // Validation is bypassed (reached step two with no last name), then Finish throws
      await checkout.assertPathIs(ROUTES.CHECKOUT_STEP_TWO);
      await expect(checkout.confirmationHeader).toBeHidden();
      // Exactly two errors: the last-name handler, then Finish. The Finish message is
      // minified code ("wa.cesetRart is not a function"), so only its presence is asserted.
      expect(pageErrors, 'Last-name handler error, then one Finish error').toHaveLength(2);
      expect(pageErrors[0]).toBe(LAST_NAME_INPUT_ERROR);
    },
  },
  visual: {
    'product images load': async ({ inventory }: Ctx) => {
      // Only the Backpack image is broken
      const broken = inventory.productItems.locator('img[src*="sl-404"]');
      await expect(broken).toHaveCount(1);
      await expect(inventory.productItems.filter({ hasText: PRODUCTS.BACKPACK.name }).locator('img[src*="sl-404"]')).toHaveCount(1);
    },
    randomizedPrices: expectRandomizedPrices,
  },
} as const;

// ── Users and their known bugs (observed on the live site) ───────────────────

type KnownBug = { description: string; signature: Check };

const USER_VARIANTS: { user: User; knownBugs: Partial<Record<CheckName, KnownBug>> }[] = [
  {
    user: USERS.STANDARD,
    knownBugs: {}, // control: every check must pass
  },
  {
    user: USERS.PROBLEM,
    knownBugs: {
      'product images load': { description: 'every product shows the 404 placeholder image', signature: SIGNATURES.problem['product images load'] },
      'sort by name Z to A': { description: 'sorting is silently ignored', signature: SIGNATURES.problem.sortIgnoredSilently },
      'sort by price low to high': { description: 'sorting is silently ignored', signature: SIGNATURES.problem.sortIgnoredSilently },
      'add every product to the cart': { description: 'Bolt T-Shirt, Fleece Jacket and Red T-Shirt silently fail to add', signature: SIGNATURES.problem.addFailsSilently },
      'remove products from the cart': { description: 'remove buttons silently do nothing', signature: SIGNATURES.problem.addFailsSilently },
      'checkout form keeps typed values': { description: 'typing the last name overwrites the first name field', signature: SIGNATURES.problem['checkout form keeps typed values'] },
      'complete an order': { description: 'blocked at step one: "Last Name is required"', signature: SIGNATURES.problem['complete an order'] },
    },
  },
  {
    user: USERS.ERROR,
    knownBugs: {
      'sort by name Z to A': { description: 'alert "Sorting is broken!" and order is unchanged', signature: SIGNATURES.error.sortIgnoredWithAlert },
      'sort by price low to high': { description: 'alert "Sorting is broken!" and order is unchanged', signature: SIGNATURES.error.sortIgnoredWithAlert },
      'add every product to the cart': { description: 'three products throw "Failed to add item to the cart."', signature: SIGNATURES.error['add every product to the cart'] },
      'remove products from the cart': { description: 'remove throws "Failed to remove item from cart."', signature: SIGNATURES.error['remove products from the cart'] },
      'checkout form keeps typed values': { description: 'last name field stays empty', signature: SIGNATURES.error['checkout form keeps typed values'] },
      'complete an order': { description: 'continues with no last name, then Finish throws a page error', signature: SIGNATURES.error['complete an order'] },
    },
  },
  {
    user: USERS.PERFORMANCE_GLITCH,
    knownBugs: {}, // ~5s login and sorts, then fully functional: must pass with no sleeps
  },
  {
    user: USERS.VISUAL,
    knownBugs: {
      'product images load': { description: 'Sauce Labs Backpack shows the 404 placeholder image', signature: SIGNATURES.visual['product images load'] },
      'prices match the catalog': { description: 'prices are randomized and change on every render', signature: SIGNATURES.visual.randomizedPrices },
      'sort by price low to high': { description: 'prices re-randomize, so the list is never in order', signature: SIGNATURES.visual.randomizedPrices },
    },
  },
];

// ── Test matrix ──────────────────────────────────────────────────────────────

type Fixtures = { page: Page; loginPage: LoginPage; inventoryPage: InventoryPage; cartPage: CartPage; checkoutPage: CheckoutPage };

/** Starts recording dialogs and page errors, then logs in as `user`. */
async function startAs(user: User, f: Fixtures, wait: { timeout: number }): Promise<Ctx> {
  const ctx: Ctx = {
    page: f.page, login: f.loginPage, inventory: f.inventoryPage, cart: f.cartPage, checkout: f.checkoutPage,
    wait, dialogs: [], pageErrors: [],
  };
  f.page.on('dialog', async (dialog) => {
    ctx.dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  f.page.on('pageerror', (error) => ctx.pageErrors.push(error.message));

  await f.loginPage.goto();
  await f.loginPage.login(user.username, user.password);
  await f.inventoryPage.assertOnInventoryPage();
  return ctx;
}

for (const { user, knownBugs } of USER_VARIANTS) {
  test.describe(`User variant: ${user.username}`, () => {
    for (const [checkName, check] of Object.entries(CHECKS) as [CheckName, Check][]) {
      const bug = knownBugs[checkName];

      if (bug === undefined) {
        test(`${checkName}`, async ({ page, loginPage, inventoryPage, cartPage, checkoutPage }) => {
          const ctx = await startAs(user, { page, loginPage, inventoryPage, cartPage, checkoutPage }, WORKING_WAIT);
          await check(ctx);
        });
      } else {
        test(`${checkName} [known bug]`, async ({ page, loginPage, inventoryPage, cartPage, checkoutPage }) => {
          test.info().annotations.push({ type: 'known bug', description: bug.description });
          const ctx = await startAs(user, { page, loginPage, inventoryPage, cartPage, checkoutPage }, KNOWN_BUG_WAIT);

          // 1. The normal check must catch the bug...
          const caught = await check(ctx).then(() => false, () => true);
          expect(caught, `Check should fail for known bug "${bug.description}". If it passed, the bug may be fixed: update this matrix.`).toBe(true);

          // 2. ...and the page must show this bug's exact signature.
          await bug.signature(ctx);
        });
      }
    }
  });
}
