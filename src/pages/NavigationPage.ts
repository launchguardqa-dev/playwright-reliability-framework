import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * NavigationPage
 * Handles the burger menu and global navigation elements
 * present across all authenticated screens.
 */
export class NavigationPage extends BasePage {
  // ── Locators ─────────────────────────────────────────────
  readonly menuButton: Locator;
  readonly closeMenuButton: Locator;
  readonly menuPanel: Locator;
  readonly allItemsLink: Locator;
  readonly aboutLink: Locator;
  readonly logoutLink: Locator;
  readonly resetAppStateLink: Locator;
  readonly cartIcon: Locator;

  constructor(page: Page) {
    super(page);
    this.menuButton = page.locator('#react-burger-menu-btn');
    this.closeMenuButton = page.locator('#react-burger-cross-btn');
    this.menuPanel = page.locator('.bm-menu-wrap');
    this.allItemsLink = page.locator('[data-test="inventory-sidebar-link"]');
    this.aboutLink = page.locator('[data-test="about-sidebar-link"]');
    this.logoutLink = page.locator('[data-test="logout-sidebar-link"]');
    this.resetAppStateLink = page.locator('[data-test="reset-sidebar-link"]');
    this.cartIcon = page.locator('[data-test="shopping-cart-link"]');
  }

  // ── Actions ──────────────────────────────────────────────

  async openMenu(): Promise<void> {
    await this.clickElement(this.menuButton);
    await this.menuPanel.waitFor({ state: 'visible' });
  }

  async closeMenu(): Promise<void> {
    await this.clickElement(this.closeMenuButton);
    await this.menuPanel.waitFor({ state: 'hidden' });
  }

  async logout(): Promise<void> {
    await this.openMenu();
    await this.clickElement(this.logoutLink);
  }

  async goToAllItems(): Promise<void> {
    await this.openMenu();
    await this.clickElement(this.allItemsLink);
  }

  async resetAppState(): Promise<void> {
    await this.openMenu();
    await this.clickElement(this.resetAppStateLink);
  }

  async goToCart(): Promise<void> {
    await this.clickElement(this.cartIcon);
  }

  // ── Assertions ───────────────────────────────────────────

  async assertMenuOpen(): Promise<void> {
    await this.assertVisible(this.logoutLink, 'Logout link should be visible when menu is open');
  }

  async assertMenuClosed(): Promise<void> {
    await this.menuPanel.waitFor({ state: 'hidden' });
  }

  async assertLogoutLinkVisible(): Promise<void> {
    await this.assertVisible(this.logoutLink, 'Logout link should be visible');
  }
}
