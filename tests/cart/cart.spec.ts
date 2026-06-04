import { test } from '../../src/fixtures';
import { CartPage } from '../../src/pages/CartPage';

/**
 * Cart Tests
 *
 * Uses the authenticatedInventoryPage fixture to skip login boilerplate.
 * Tests focus purely on cart behavior — no login logic here.
 */
test.describe('Shopping Cart', () => {
  test('should add a single item to cart @smoke', async ({ authenticatedInventoryPage }) => {
    const productName = 'sauce-labs-backpack';

    await authenticatedInventoryPage.addItemToCart(productName);
    await authenticatedInventoryPage.assertCartCount(1);
    await authenticatedInventoryPage.assertItemInCart(productName);
  });

  test('should add multiple items to cart', async ({ authenticatedInventoryPage }) => {
    await authenticatedInventoryPage.addItemToCart('sauce-labs-backpack');
    await authenticatedInventoryPage.addItemToCart('sauce-labs-bike-light');

    await authenticatedInventoryPage.assertCartCount(2);
  });

  test('should remove an item from cart', async ({ authenticatedInventoryPage }) => {
    const productName = 'sauce-labs-backpack';

    await authenticatedInventoryPage.addItemToCart(productName);
    await authenticatedInventoryPage.assertCartCount(1);

    await authenticatedInventoryPage.removeItemFromCart(productName);
    await authenticatedInventoryPage.assertCartCount(0);
  });

  test('should display added item in cart view @smoke', async ({ page, authenticatedInventoryPage }) => {
    await authenticatedInventoryPage.addItemToCart('sauce-labs-backpack');
    await authenticatedInventoryPage.goToCart();

    const cartPage = new CartPage(page);
    await cartPage.assertOnCartPage();
    await cartPage.assertItemInCart('Sauce Labs Backpack');
    await cartPage.assertItemCount(1);
  });

  test('should reflect empty cart after removing all items', async ({ page, authenticatedInventoryPage }) => {
    await authenticatedInventoryPage.addItemToCart('sauce-labs-backpack');
    await authenticatedInventoryPage.removeItemFromCart('sauce-labs-backpack');
    await authenticatedInventoryPage.goToCart();

    const cartPage = new CartPage(page);
    await cartPage.assertCartEmpty();
  });

  test('should continue shopping from cart', async ({ page, authenticatedInventoryPage }) => {
    await authenticatedInventoryPage.addItemToCart('sauce-labs-backpack');
    await authenticatedInventoryPage.goToCart();

    const cartPage = new CartPage(page);
    await cartPage.continueShopping();
    await authenticatedInventoryPage.assertOnInventoryPage();
  });
});
