import { test } from '../../src/fixtures';
import { InventoryPage } from '../../src/pages/InventoryPage';
import { CartPage } from '../../src/pages/CartPage';
import { CheckoutPage } from '../../src/pages/CheckoutPage';
import { CHECKOUT_INFO, CHECKOUT_ERRORS, PRODUCTS } from '../../src/constants/checkout';

/**
 * Checkout Tests
 *
 * Covers the full purchase flow: cart → step one → step two → complete.
 * Also covers form validation and cancellation paths.
 */

type ShippingInfo = { firstName: string; lastName: string; zipCode: string };

/** Adds a product, opens the cart, and lands on checkout step one. */
async function startCheckoutWith(
  inventory: InventoryPage,
  cart: CartPage,
  checkout: CheckoutPage,
  productId: string = PRODUCTS.BACKPACK.dataTestId
): Promise<void> {
  await inventory.addItemToCart(productId);
  await inventory.goToCart();
  await cart.assertOnCartPage();
  await cart.proceedToCheckout();
  await checkout.assertOnStepOne();
}

async function submitShipping(checkout: CheckoutPage, info: ShippingInfo): Promise<void> {
  await checkout.fillShippingInfo(info.firstName, info.lastName, info.zipCode);
  await checkout.continue();
}

test.describe('Checkout Flow', () => {

  test('should complete full checkout flow end to end @smoke', async ({ authenticatedInventoryPage, cartPage, checkoutPage }) => {
    await startCheckoutWith(authenticatedInventoryPage, cartPage, checkoutPage);
    await submitShipping(checkoutPage, CHECKOUT_INFO.VALID);

    await checkoutPage.assertOnStepTwo();
    await checkoutPage.assertItemInSummary(PRODUCTS.BACKPACK.name);
    await checkoutPage.assertTotalVisible();

    await checkoutPage.finish();

    await checkoutPage.assertOnComplete();
    await checkoutPage.assertConfirmationHeader('Thank you for your order!');
  });

  test('should show order summary with correct item on step two', async ({ authenticatedInventoryPage, cartPage, checkoutPage }) => {
    await startCheckoutWith(authenticatedInventoryPage, cartPage, checkoutPage, PRODUCTS.BIKE_LIGHT.dataTestId);
    await submitShipping(checkoutPage, CHECKOUT_INFO.VALID);

    await checkoutPage.assertOnStepTwo();
    await checkoutPage.assertItemInSummary(PRODUCTS.BIKE_LIGHT.name);
  });

  const validationCases = [
    { field: 'first name', info: CHECKOUT_INFO.MISSING_FIRST_NAME, error: CHECKOUT_ERRORS.MISSING_FIRST_NAME },
    { field: 'last name', info: CHECKOUT_INFO.MISSING_LAST_NAME, error: CHECKOUT_ERRORS.MISSING_LAST_NAME },
    { field: 'zip code', info: CHECKOUT_INFO.MISSING_ZIP, error: CHECKOUT_ERRORS.MISSING_ZIP },
  ];

  for (const { field, info, error } of validationCases) {
    test(`should show error when ${field} is missing`, async ({ authenticatedInventoryPage, cartPage, checkoutPage }) => {
      await startCheckoutWith(authenticatedInventoryPage, cartPage, checkoutPage);
      await submitShipping(checkoutPage, info);

      await checkoutPage.assertErrorMessage(error);
      await checkoutPage.assertOnStepOne();
    });
  }

  test('should cancel checkout from step one and return to cart', async ({ authenticatedInventoryPage, cartPage, checkoutPage }) => {
    await startCheckoutWith(authenticatedInventoryPage, cartPage, checkoutPage);

    await checkoutPage.cancel();

    await cartPage.assertOnCartPage();
  });

  test('should cancel checkout from step two and return to inventory', async ({ authenticatedInventoryPage, cartPage, checkoutPage }) => {
    await startCheckoutWith(authenticatedInventoryPage, cartPage, checkoutPage);
    await submitShipping(checkoutPage, CHECKOUT_INFO.VALID);
    await checkoutPage.assertOnStepTwo();

    await checkoutPage.cancel();

    await authenticatedInventoryPage.assertOnInventoryPage();
  });

  test('should return to inventory after completing order', async ({ authenticatedInventoryPage, cartPage, checkoutPage }) => {
    await startCheckoutWith(authenticatedInventoryPage, cartPage, checkoutPage);
    await submitShipping(checkoutPage, CHECKOUT_INFO.VALID);
    await checkoutPage.finish();
    await checkoutPage.assertOnComplete();

    await checkoutPage.backToProducts();

    await authenticatedInventoryPage.assertOnInventoryPage();
    await authenticatedInventoryPage.assertCartCount(0);
  });
});
