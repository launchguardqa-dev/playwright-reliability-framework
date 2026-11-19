import { test, expect } from '../../src/fixtures';
import { PRODUCTS } from '../../src/constants/checkout';

/**
 * Sorting Tests
 *
 * Verifies the product sort dropdown correctly reorders the inventory.
 * Tests data integrity: not just that the dropdown works, but that
 * the resulting order is actually correct.
 */
test.describe('Product Sorting', () => {

  test('should sort products by name A to Z by default', async ({ authenticatedInventoryPage }) => {
    const names = await authenticatedInventoryPage.getProductNames();

    expect(names).toEqual([...names].sort());
  });

  test('should sort products by name Z to A', async ({ authenticatedInventoryPage }) => {
    await authenticatedInventoryPage.sortBy('za');
    const names = await authenticatedInventoryPage.getProductNames();

    expect(names).toEqual([...names].sort().reverse());
  });

  test('should sort products by price low to high', async ({ authenticatedInventoryPage }) => {
    await authenticatedInventoryPage.sortBy('lohi');
    const prices = await authenticatedInventoryPage.getProductPrices();

    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  test('should sort products by price high to low', async ({ authenticatedInventoryPage }) => {
    await authenticatedInventoryPage.sortBy('hilo');
    const prices = await authenticatedInventoryPage.getProductPrices();

    expect(prices).toEqual([...prices].sort((a, b) => b - a));
  });

  test('should display all 6 products on inventory page', async ({ authenticatedInventoryPage }) => {
    await authenticatedInventoryPage.assertProductCount(6);
  });

  test('should maintain cart count after sorting', async ({ authenticatedInventoryPage }) => {
    await authenticatedInventoryPage.addItemToCart(PRODUCTS.BACKPACK.dataTestId);
    await authenticatedInventoryPage.assertCartCount(1);

    await authenticatedInventoryPage.sortBy('hilo');

    // Cart badge should still show 1 after sorting
    await authenticatedInventoryPage.assertCartCount(1);
  });
});
