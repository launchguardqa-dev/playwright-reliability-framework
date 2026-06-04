import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * CartPage
 * Represents the shopping cart view.
 */
export class CartPage extends BasePage {
  // ── Locators ─────────────────────────────────────────────
  readonly pageTitle: Locator;
  readonly checkoutButton: Locator;
  readonly continueShoppingButton: Locator;
  readonly cartItems: Locator;

  constructor(page: Page) {
    super(page);
    this.pageTitle = page.locator('[data-test="title"]');
    this.checkoutButton = page.locator('[data-test="checkout"]');
    this.continueShoppingButton = page.locator('[data-test="continue-shopping"]');
    this.cartItems = page.locator('.cart_item');
  }

  // ── Locator Helpers ──────────────────────────────────────

  getCartItemByName(productName: string): Locator {
    return this.cartItems.filter({ hasText: productName });
  }

  getItemPrice(productName: string): Locator {
    return this.getCartItemByName(productName).locator('.inventory_item_price');
  }

  // ── Actions ──────────────────────────────────────────────

  async continueShopping(): Promise<void> {
    await this.clickElement(this.continueShoppingButton);
  }

  async proceedToCheckout(): Promise<void> {
    await this.clickElement(this.checkoutButton);
  }

  // ── Assertions ───────────────────────────────────────────

  async assertOnCartPage(): Promise<void> {
    await this.assertVisible(this.pageTitle, 'Cart page title should be visible');
    await this.assertText(this.pageTitle, 'Your Cart');
  }

  async assertItemInCart(productName: string): Promise<void> {
    await this.assertVisible(
      this.getCartItemByName(productName),
      `"${productName}" should appear in the cart`
    );
  }

  async assertItemCount(expectedCount: number): Promise<void> {
    await this.cartItems.nth(expectedCount - 1).waitFor({ state: 'visible' });
    const count = await this.cartItems.count();
    if (count !== expectedCount) {
      throw new Error(`Expected ${expectedCount} cart items but found ${count}`);
    }
  }

  async assertCartEmpty(): Promise<void> {
    const count = await this.cartItems.count();
    if (count !== 0) {
      throw new Error(`Expected empty cart but found ${count} items`);
    }
  }
}
