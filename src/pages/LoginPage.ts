import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';
import { ROUTES } from '../constants/routes';

/**
 * LoginPage
 * Encapsulates all interactions with the SauceDemo login screen.
 */
export class LoginPage extends BasePage {
  // ── Locators ─────────────────────────────────────────────
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly errorMessage: Locator;
  readonly errorCloseButton: Locator;

  constructor(page: Page) {
    super(page);
    this.usernameInput = page.locator('[data-test="username"]');
    this.passwordInput = page.locator('[data-test="password"]');
    this.loginButton = page.locator('[data-test="login-button"]');
    this.errorMessage = page.locator('[data-test="error"]');
    this.errorCloseButton = page.locator('[data-test="error-button"]');
  }

  // ── Navigation ───────────────────────────────────────────

  async goto(): Promise<void> {
    await this.navigate(ROUTES.LOGIN);
  }

  // ── Actions ──────────────────────────────────────────────

  async login(username: string, password: string): Promise<void> {
    await this.fillField(this.usernameInput, username);
    await this.fillField(this.passwordInput, password);
    await this.clickElement(this.loginButton);
  }

  async clearError(): Promise<void> {
    await this.clickElement(this.errorCloseButton);
  }

  // ── Assertions ───────────────────────────────────────────

  async assertErrorVisible(): Promise<void> {
    await this.assertVisible(this.errorMessage, 'Login error message should be visible');
  }

  async assertErrorMessage(expectedMessage: string): Promise<void> {
    await this.assertText(this.errorMessage, expectedMessage);
  }

  async assertOnLoginPage(): Promise<void> {
    await this.assertVisible(this.loginButton, 'Login button should be visible on login page');
  }
}
