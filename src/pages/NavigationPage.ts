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
  /** The menu wrapper once the app's startup hide-timer has run (see openMenu). */
  readonly settledClosedMenu: Locator;

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
    this.settledClosedMenu = page.locator('.bm-menu-wrap[hidden]');
  }

  // ── Actions ──────────────────────────────────────────────

  /**
   * Opens the burger menu, avoiding a race condition in the app.
   *
   * The menu (react-burger-menu) starts a 500ms timer on page load that adds
   * `hidden` to the menu. A click that lands right around that 500ms mark is
   * overwritten by the timer: state says open (aria-hidden="false") but the
   * menu stays `hidden`, so it never appears. Reproduced 6/6 with a click
   * ~450ms after load; found via a SLOW_MO=500 run.
   *
   * Fix: wait for the settled closed state (`hidden` present) before
   * clicking. This is a condition-based wait, not a sleep.
   */
  async openMenu(): Promise<void> {
    await this.settledClosedMenu.waitFor({ state: 'attached' });
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
