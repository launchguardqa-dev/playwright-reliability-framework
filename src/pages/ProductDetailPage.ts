import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * ProductDetailPage
 * Represents the individual product detail screen (/inventory-item.html)
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
    this.addToCartButton = page.locator('[data-test^="add-to-cart"]');
    this.removeButton = page.locator('[data-test^="remove"]');
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

  async assertOnDetailPage(): Promise<void> {
    await this.assertVisible(this.productName, 'Product name should be visible on detail page');
    await this.assertUrlContains('inventory-item.html');
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
