import { test } from '../../src/fixtures';
import { PRODUCTS } from '../../src/constants/checkout';

/**
 * Product Detail Tests
 *
 * Verifies the individual product page loads correctly
 * and that cart actions work from the detail view.
 */
test.describe('Product Detail', () => {

  test('should navigate to product detail page by clicking product name', async ({ authenticatedInventoryPage, productDetailPage }) => {
    await authenticatedInventoryPage.openProduct(PRODUCTS.BACKPACK.name);

    await productDetailPage.assertOnDetailPage();
    await productDetailPage.assertProductName(PRODUCTS.BACKPACK.name);
  });

  test('should display all product detail elements', async ({ authenticatedInventoryPage, productDetailPage }) => {
    await authenticatedInventoryPage.openProduct(PRODUCTS.BACKPACK.name);

    await productDetailPage.assertOnDetailPage();
    await productDetailPage.assertPriceVisible();
    await productDetailPage.assertDescriptionVisible();
    await productDetailPage.assertImageVisible();
    await productDetailPage.assertAddToCartVisible();
  });

  test('should add item to cart from product detail page @smoke', async ({ authenticatedInventoryPage, productDetailPage }) => {
    await authenticatedInventoryPage.openProduct(PRODUCTS.BACKPACK.name);

    await productDetailPage.addToCart();
    await productDetailPage.assertCartCount(1);
    await productDetailPage.assertRemoveVisible();
  });

  test('should remove item from cart on product detail page', async ({ authenticatedInventoryPage, productDetailPage }) => {
    await authenticatedInventoryPage.openProduct(PRODUCTS.BACKPACK.name);

    await productDetailPage.addToCart();
    await productDetailPage.assertRemoveVisible();

    await productDetailPage.removeFromCart();
    await productDetailPage.assertAddToCartVisible();
  });

  test('should return to inventory when back button is clicked', async ({ authenticatedInventoryPage, productDetailPage }) => {
    await authenticatedInventoryPage.openProduct(PRODUCTS.BACKPACK.name);

    await productDetailPage.assertOnDetailPage();
    await productDetailPage.goBack();

    await authenticatedInventoryPage.assertOnInventoryPage();
  });

  test('should preserve cart state when navigating back from detail page', async ({ authenticatedInventoryPage, productDetailPage }) => {
    // Add one item from inventory
    await authenticatedInventoryPage.addItemToCart(PRODUCTS.BIKE_LIGHT.dataTestId);

    // Add a different item from its detail page
    await authenticatedInventoryPage.openProduct(PRODUCTS.BACKPACK.name);
    await productDetailPage.addToCart();

    // Go back: cart should have 2 items
    await productDetailPage.goBack();
    await authenticatedInventoryPage.assertCartCount(2);
  });
});
