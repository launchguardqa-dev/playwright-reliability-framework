import { test, expect } from '../../src/fixtures';
import { CheckoutPage } from '../../src/pages/CheckoutPage';
import { CartPage } from '../../src/pages/CartPage';
import { CHECKOUT_INFO, CHECKOUT_ERRORS, PRODUCTS } from '../../src/constants/checkout';

/**
 * Checkout Tests
 *
 * Covers the full purchase flow: cart → step one → step two → complete.
 * Also covers form validation and cancellation paths.
 */
test.describe('Checkout Flow', () => {

  test('should complete full checkout flow end to end @smoke', async ({ page, authenticatedInventoryPage }) => {
    const checkoutPage = new CheckoutPage(page);
    const cartPage = new CartPage(page);

    // Add item and go to cart
    await authenticatedInventoryPage.addItemToCart(PRODUCTS.BACKPACK.dataTestId);
    await authenticatedInventoryPage.goToCart();

    // Proceed to checkout
    await cartPage.assertOnCartPage();
    await cartPage.proceedToCheckout();

    // Fill shipping info
    await checkoutPage.assertOnStepOne();
    await checkoutPage.fillShippingInfo(
      CHECKOUT_INFO.VALID.firstName,
      CHECKOUT_INFO.VALID.lastName,
      CHECKOUT_INFO.VALID.zipCode
    );
    await checkoutPage.continue();

    // Verify order summary
    await checkoutPage.assertOnStepTwo();
    await checkoutPage.assertItemInSummary(PRODUCTS.BACKPACK.name);
    await checkoutPage.assertTotalVisible();

    // Finish order
    await checkoutPage.finish();

    // Confirm success
    await checkoutPage.assertOnComplete();
    await checkoutPage.assertConfirmationHeader('Thank you for your order!');
  });

  test('should show order summary with correct item on step two', async ({ page, authenticatedInventoryPage }) => {
    const checkoutPage = new CheckoutPage(page);
    const cartPage = new CartPage(page);

    await authenticatedInventoryPage.addItemToCart(PRODUCTS.BIKE_LIGHT.dataTestId);
    await authenticatedInventoryPage.goToCart();
    await cartPage.proceedToCheckout();
    await checkoutPage.fillShippingInfo(
      CHECKOUT_INFO.VALID.firstName,
      CHECKOUT_INFO.VALID.lastName,
      CHECKOUT_INFO.VALID.zipCode
    );
    await checkoutPage.continue();

    await checkoutPage.assertOnStepTwo();
    await checkoutPage.assertItemInSummary(PRODUCTS.BIKE_LIGHT.name);
  });

  test('should show error when first name is missing', async ({ page, authenticatedInventoryPage }) => {
    const checkoutPage = new CheckoutPage(page);
    const cartPage = new CartPage(page);

    await authenticatedInventoryPage.addItemToCart(PRODUCTS.BACKPACK.dataTestId);
    await authenticatedInventoryPage.goToCart();
    await cartPage.proceedToCheckout();

    await checkoutPage.fillShippingInfo(
      CHECKOUT_INFO.MISSING_FIRST_NAME.firstName,
      CHECKOUT_INFO.MISSING_FIRST_NAME.lastName,
      CHECKOUT_INFO.MISSING_FIRST_NAME.zipCode
    );
    await checkoutPage.continue();

    await checkoutPage.assertErrorMessage(CHECKOUT_ERRORS.MISSING_FIRST_NAME);
  });

  test('should show error when last name is missing', async ({ page, authenticatedInventoryPage }) => {
    const checkoutPage = new CheckoutPage(page);
    const cartPage = new CartPage(page);

    await authenticatedInventoryPage.addItemToCart(PRODUCTS.BACKPACK.dataTestId);
    await authenticatedInventoryPage.goToCart();
    await cartPage.proceedToCheckout();

    await checkoutPage.fillShippingInfo(
      CHECKOUT_INFO.MISSING_LAST_NAME.firstName,
      CHECKOUT_INFO.MISSING_LAST_NAME.lastName,
      CHECKOUT_INFO.MISSING_LAST_NAME.zipCode
    );
    await checkoutPage.continue();

    await checkoutPage.assertErrorMessage(CHECKOUT_ERRORS.MISSING_LAST_NAME);
  });

  test('should show error when zip code is missing', async ({ page, authenticatedInventoryPage }) => {
    const checkoutPage = new CheckoutPage(page);
    const cartPage = new CartPage(page);

    await authenticatedInventoryPage.addItemToCart(PRODUCTS.BACKPACK.dataTestId);
    await authenticatedInventoryPage.goToCart();
    await cartPage.proceedToCheckout();

    await checkoutPage.fillShippingInfo(
      CHECKOUT_INFO.MISSING_ZIP.firstName,
      CHECKOUT_INFO.MISSING_ZIP.lastName,
      CHECKOUT_INFO.MISSING_ZIP.zipCode
    );
    await checkoutPage.continue();

    await checkoutPage.assertErrorMessage(CHECKOUT_ERRORS.MISSING_ZIP);
  });

  test('should cancel checkout from step one and return to cart', async ({ page, authenticatedInventoryPage }) => {
    const checkoutPage = new CheckoutPage(page);
    const cartPage = new CartPage(page);

    await authenticatedInventoryPage.addItemToCart(PRODUCTS.BACKPACK.dataTestId);
    await authenticatedInventoryPage.goToCart();
    await cartPage.proceedToCheckout();

    await checkoutPage.assertOnStepOne();
    await checkoutPage.cancel();

    await cartPage.assertOnCartPage();
  });

  test('should cancel checkout from step two and return to cart', async ({ page, authenticatedInventoryPage }) => {
    const checkoutPage = new CheckoutPage(page);
    const cartPage = new CartPage(page);

    await authenticatedInventoryPage.addItemToCart(PRODUCTS.BACKPACK.dataTestId);
    await authenticatedInventoryPage.goToCart();
    await cartPage.proceedToCheckout();
    await checkoutPage.fillShippingInfo(
      CHECKOUT_INFO.VALID.firstName,
      CHECKOUT_INFO.VALID.lastName,
      CHECKOUT_INFO.VALID.zipCode
    );
    await checkoutPage.continue();
    await checkoutPage.assertOnStepTwo();
    await checkoutPage.cancel();

    await authenticatedInventoryPage.assertOnInventoryPage();
  });

  test('should return to inventory after completing order', async ({ page, authenticatedInventoryPage }) => {
    const checkoutPage = new CheckoutPage(page);
    const cartPage = new CartPage(page);

    await authenticatedInventoryPage.addItemToCart(PRODUCTS.BACKPACK.dataTestId);
    await authenticatedInventoryPage.goToCart();
    await cartPage.proceedToCheckout();
    await checkoutPage.fillShippingInfo(
      CHECKOUT_INFO.VALID.firstName,
      CHECKOUT_INFO.VALID.lastName,
      CHECKOUT_INFO.VALID.zipCode
    );
    await checkoutPage.continue();
    await checkoutPage.finish();
    await checkoutPage.assertOnComplete();
    await checkoutPage.backToProducts();

    await authenticatedInventoryPage.assertOnInventoryPage();
  });
});
