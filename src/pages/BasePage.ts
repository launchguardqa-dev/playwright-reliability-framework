import { Page, Locator, expect } from '@playwright/test';

/**
 * BasePage
 * Provides shared navigation, wait, and assertion helpers
 * that all Page Objects inherit. Centralizing this logic
 * means one fix propagates everywhere — key for reliability.
 */
export class BasePage {
  constructor(protected readonly page: Page) {}

  // ── Navigation ───────────────────────────────────────────

  async navigate(path: string): Promise<void> {
    await this.page.goto(path);
    await this.waitForPageLoad();
  }

  async waitForPageLoad(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
  }

  async getCurrentUrl(): Promise<string> {
    return this.page.url();
  }

  // ── Interaction ──────────────────────────────────────────

  /**
   * Typed fill — clears the field first to avoid appending to existing values.
   * A common source of flakiness when fields aren't properly cleared.
   */
  async fillField(locator: Locator, value: string): Promise<void> {
    await locator.waitFor({ state: 'visible' });
    await locator.clear();
    await locator.fill(value);
  }

  async clickElement(locator: Locator): Promise<void> {
    await locator.waitFor({ state: 'visible' });
    await locator.click();
  }

  // ── Assertions ───────────────────────────────────────────

  async assertVisible(locator: Locator, message?: string): Promise<void> {
    await expect(locator, message).toBeVisible();
  }

  async assertText(locator: Locator, text: string): Promise<void> {
    await expect(locator).toHaveText(text);
  }

  async assertUrlContains(path: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(path));
  }

  async assertUrlEquals(url: string): Promise<void> {
    await expect(this.page).toHaveURL(url);
  }

  // ── Waiting ──────────────────────────────────────────────

  /**
   * Waits for a network response matching a URL pattern.
   * Useful for asserting API calls complete before continuing.
   */
  async waitForResponse(urlPattern: string | RegExp): Promise<void> {
    await this.page.waitForResponse(urlPattern);
  }
}
