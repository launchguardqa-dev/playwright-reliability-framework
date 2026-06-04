import { test, expect } from '../../src/fixtures';

/**
 * Sorting Tests
 *
 * Verifies the product sort dropdown correctly reorders the inventory.
 * Tests data integrity — not just that the dropdown works, but that
 * the resulting order is actually correct.
 */
test.describe('Product Sorting', () => {

  test('should sort products by name A to Z by default', async ({ authenticatedInventoryPage }) => {
    const names = await authenticatedInventoryPage.page
      .locator('[data-test="inventory-item-name"]')
      .allTextContents();

    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  test('should sort products by name Z to A', async ({ authenticatedInventoryPage }) => {
    await authenticatedInventoryPage.sortBy('za');

    const names = await authenticatedInventoryPage.page
      .locator('[data-test="inventory-item-name"]')
      .allTextContents();

    const sorted = [...names].sort().reverse();
    expect(names).toEqual(sorted);
  });

  test('should sort products by price low to high', async ({ authenticatedInventoryPage }) => {
    await authenticatedInventoryPage.sortBy('lohi');

    const priceTexts = await authenticatedInventoryPage.page
      .locator('[data-test="inventory-item-price"]')
      .allTextContents();

    const prices = priceTexts.map(p => parseFloat(p.replace('$', '')));
    const sorted = [...prices].sort((a, b) => a - b);
    expect(prices).toEqual(sorted);
  });

  test('should sort products by price high to low', async ({ authenticatedInventoryPage }) => {
    await authenticatedInventoryPage.sortBy('hilo');

    const priceTexts = await authenticatedInventoryPage.page
      .locator('[data-test="inventory-item-price"]')
      .allTextContents();

    const prices = priceTexts.map(p => parseFloat(p.replace('$', '')));
    const sorted = [...prices].sort((a, b) => b - a);
    expect(prices).toEqual(sorted);
  });

  test('should display all 6 products on inventory page', async ({ authenticatedInventoryPage }) => {
    const items = authenticatedInventoryPage.page.locator('.inventory_item');
    await expect(items).toHaveCount(6);
  });

  test('should maintain cart count after sorting', async ({ authenticatedInventoryPage }) => {
    await authenticatedInventoryPage.addItemToCart('sauce-labs-backpack');
    await authenticatedInventoryPage.assertCartCount(1);

    await authenticatedInventoryPage.sortBy('hilo');

    // Cart badge should still show 1 after sorting
    await authenticatedInventoryPage.assertCartCount(1);
  });
});
