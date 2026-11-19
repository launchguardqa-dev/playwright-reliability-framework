import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { ROUTES } from '../constants/routes';

/**
 * ProductDetailPage
 * Represents the individual product detail screen (/inventory-item.html)
 *
 * Reliability note: the detail page reuses several data-test ids from the
 * inventory list (e.g. "inventory-item-name"). Locators here use the exact
 * detail-page ids ("add-to-cart", "remove") and every entry point waits for
 * the detail URL first, so a locator can never resolve against the list page
 * while navigation is still in flight.
 */
export class ProductDetailPage extends BasePage {
  // ── Locators ─────────────────────────────────────────────
  readonly productName: Locator;
  readonly productDescription: Locator;
  readonly productPrice: Locator;
  readonly addToCartButton: Locator;
  readonly removeButton: Locator;
  readonly backButton: Locator;
  readonly productImage: Locator;
  readonly cartBadge: Locator;

  constructor(page: Page) {
    super(page);
    this.productName = page.locator('[data-test="inventory-item-name"]');
    this.productDescription = page.locator('[data-test="inventory-item-desc"]');
    this.productPrice = page.locator('[data-test="inventory-item-price"]');
    this.addToCartButton = page.locator('[data-test="add-to-cart"]');
    this.removeButton = page.locator('[data-test="remove"]');
    this.backButton = page.locator('[data-test="back-to-products"]');
    this.productImage = page.locator('.inventory_details_img');
    this.cartBadge = page.locator('[data-test="shopping-cart-badge"]');
  }

  // ── Actions ──────────────────────────────────────────────

  async addToCart(): Promise<void> {
    await this.clickElement(this.addToCartButton);
  }

  async removeFromCart(): Promise<void> {
    await this.clickElement(this.removeButton);
  }

  async goBack(): Promise<void> {
    await this.clickElement(this.backButton);
  }

  // ── Assertions ───────────────────────────────────────────

  /** Waits for the detail URL before checking content, never the other way round. */
  async assertOnDetailPage(): Promise<void> {
    await this.assertUrlContains(ROUTES.PRODUCT_DETAIL);
    await expect(this.productName, 'Exactly one product name should show on the detail page').toHaveCount(1);
    await this.assertVisible(this.backButton, 'Back to products button should be visible on detail page');
  }

  async assertProductName(name: string): Promise<void> {
    await this.assertText(this.productName, name);
  }

  async assertPriceVisible(): Promise<void> {
    await this.assertVisible(this.productPrice, 'Product price should be visible');
  }

  async assertDescriptionVisible(): Promise<void> {
    await this.assertVisible(this.productDescription, 'Product description should be visible');
  }

  async assertImageVisible(): Promise<void> {
    await this.assertVisible(this.productImage, 'Product image should be visible');
  }

  async assertAddToCartVisible(): Promise<void> {
    await this.assertVisible(this.addToCartButton, 'Add to cart button should be visible');
  }

  async assertRemoveVisible(): Promise<void> {
    await this.assertVisible(this.removeButton, 'Remove button should be visible after adding to cart');
  }

  async assertCartCount(count: number): Promise<void> {
    await this.assertText(this.cartBadge, String(count));
  }
}
