import { test } from '../../src/fixtures';
import { ProductDetailPage } from '../../src/pages/ProductDetailPage';
import { PRODUCTS } from '../../src/constants/checkout';

/**
 * Product Detail Tests
 *
 * Verifies the individual product page loads correctly
 * and that cart actions work from the detail view.
 */
test.describe('Product Detail', () => {

  test('should navigate to product detail page by clicking product name', async ({ page, authenticatedInventoryPage }) => {
    const productDetail = new ProductDetailPage(page);

    await authenticatedInventoryPage.page
      .locator('[data-test="inventory-item-name"]')
      .filter({ hasText: PRODUCTS.BACKPACK.name })
      .click();

    await productDetail.assertOnDetailPage();
    await productDetail.assertProductName(PRODUCTS.BACKPACK.name);
  });

  test('should display all product detail elements', async ({ page, authenticatedInventoryPage }) => {
    const productDetail = new ProductDetailPage(page);

    await authenticatedInventoryPage.page
      .locator('[data-test="inventory-item-name"]')
      .filter({ hasText: PRODUCTS.BACKPACK.name })
      .click();

    await productDetail.assertOnDetailPage();
    await productDetail.assertPriceVisible();
    await productDetail.assertDescriptionVisible();
    await productDetail.assertImageVisible();
    await productDetail.assertAddToCartVisible();
  });

  test('should add item to cart from product detail page @smoke', async ({ page, authenticatedInventoryPage }) => {
    const productDetail = new ProductDetailPage(page);

    await authenticatedInventoryPage.page
      .locator('[data-test="inventory-item-name"]')
      .filter({ hasText: PRODUCTS.BACKPACK.name })
      .click();

    await productDetail.addToCart();
    await productDetail.assertCartCount(1);
    await productDetail.assertRemoveVisible();
  });

  test('should remove item from cart on product detail page', async ({ page, authenticatedInventoryPage }) => {
    const productDetail = new ProductDetailPage(page);

    await authenticatedInventoryPage.page
      .locator('[data-test="inventory-item-name"]')
      .filter({ hasText: PRODUCTS.BACKPACK.name })
      .click();

    await productDetail.addToCart();
    await productDetail.assertRemoveVisible();

    await productDetail.removeFromCart();
    await productDetail.assertAddToCartVisible();
  });

  test('should return to inventory when back button is clicked', async ({ page, authenticatedInventoryPage }) => {
    const productDetail = new ProductDetailPage(page);

    await authenticatedInventoryPage.page
      .locator('[data-test="inventory-item-name"]')
      .filter({ hasText: PRODUCTS.BACKPACK.name })
      .click();

    await productDetail.assertOnDetailPage();
    await productDetail.goBack();

    await authenticatedInventoryPage.assertOnInventoryPage();
  });

  test('should preserve cart state when navigating back from detail page', async ({ page, authenticatedInventoryPage }) => {
    const productDetail = new ProductDetailPage(page);

    // Add one item from inventory
    await authenticatedInventoryPage.addItemToCart('sauce-labs-bike-light');

    // Go to detail page of a different item
    await authenticatedInventoryPage.page
      .locator('[data-test="inventory-item-name"]')
      .filter({ hasText: PRODUCTS.BACKPACK.name })
      .click();

    // Add from detail page
    await productDetail.addToCart();

    // Go back — cart should have 2 items
    await productDetail.goBack();
    await authenticatedInventoryPage.assertCartCount(2);
  });
});
