import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';
import { ROUTES } from '../constants/routes';

/**
 * InventoryPage
 * Represents the main product listing screen after login.
 */
export class InventoryPage extends BasePage {
  // ── Locators ─────────────────────────────────────────────
  readonly pageTitle: Locator;
  readonly cartBadge: Locator;
  readonly cartIcon: Locator;
  readonly menuButton: Locator;
  readonly sortDropdown: Locator;

  constructor(page: Page) {
    super(page);
    this.pageTitle = page.locator('[data-test="title"]');
    this.cartBadge = page.locator('[data-test="shopping-cart-badge"]');
    this.cartIcon = page.locator('[data-test="shopping-cart-link"]');
    this.menuButton = page.locator('#react-burger-menu-btn');
    this.sortDropdown = page.locator('[data-test="product-sort-container"]');
  }

  // ── Locator Helpers ──────────────────────────────────────

  getAddToCartButton(productName: string): Locator {
    return this.page.locator(`[data-test="add-to-cart-${productName.toLowerCase().replace(/\s+/g, '-')}"]`);
  }

  getRemoveButton(productName: string): Locator {
    return this.page.locator(`[data-test="remove-${productName.toLowerCase().replace(/\s+/g, '-')}"]`);
  }

  getProductByName(productName: string): Locator {
    return this.page.locator('.inventory_item').filter({ hasText: productName });
  }

  // ── Actions ──────────────────────────────────────────────

  async addItemToCart(productName: string): Promise<void> {
    await this.clickElement(this.getAddToCartButton(productName));
  }

  async removeItemFromCart(productName: string): Promise<void> {
    await this.clickElement(this.getRemoveButton(productName));
  }

  async goToCart(): Promise<void> {
    await this.clickElement(this.cartIcon);
    await this.assertUrlContains(ROUTES.CART);
  }

  async sortBy(option: 'az' | 'za' | 'lohi' | 'hilo'): Promise<void> {
    await this.sortDropdown.selectOption(option);
  }

  // ── Assertions ───────────────────────────────────────────

  async assertOnInventoryPage(): Promise<void> {
    await this.assertVisible(this.pageTitle, 'Inventory page title should be visible');
    await this.assertText(this.pageTitle, 'Products');
  }

  async assertCartCount(expectedCount: number): Promise<void> {
    if (expectedCount === 0) {
      await this.cartBadge.waitFor({ state: 'hidden' });
    } else {
      await this.assertText(this.cartBadge, String(expectedCount));
    }
  }

  async assertItemInCart(productName: string): Promise<void> {
    await this.assertVisible(
      this.getRemoveButton(productName),
      `Remove button for "${productName}" should be visible after adding to cart`
    );
  }
}
