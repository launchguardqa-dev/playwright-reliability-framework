import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';
import { ROUTES } from '../constants/routes';

/**
 * CheckoutPage
 * Covers all three checkout steps:
 * Step One  — shipping info form
 * Step Two  — order summary
 * Complete  — confirmation screen
 */
export class CheckoutPage extends BasePage {
  // ── Step One Locators ────────────────────────────────────
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly zipCodeInput: Locator;
  readonly continueButton: Locator;
  readonly cancelButton: Locator;
  readonly errorMessage: Locator;

  // ── Step Two Locators ────────────────────────────────────
  readonly finishButton: Locator;
  readonly summaryTotal: Locator;
  readonly summarySubtotal: Locator;
  readonly summaryTax: Locator;
  readonly cartItems: Locator;

  // ── Complete Locators ────────────────────────────────────
  readonly confirmationHeader: Locator;
  readonly confirmationText: Locator;
  readonly backHomeButton: Locator;
  readonly ponyExpressImage: Locator;

  constructor(page: Page) {
    super(page);

    // Step One
    this.firstNameInput = page.locator('[data-test="firstName"]');
    this.lastNameInput = page.locator('[data-test="lastName"]');
    this.zipCodeInput = page.locator('[data-test="postalCode"]');
    this.continueButton = page.locator('[data-test="continue"]');
    this.cancelButton = page.locator('[data-test="cancel"]');
    this.errorMessage = page.locator('[data-test="error"]');

    // Step Two
    this.finishButton = page.locator('[data-test="finish"]');
    this.summaryTotal = page.locator('[data-test="total-label"]');
    this.summarySubtotal = page.locator('[data-test="subtotal-label"]');
    this.summaryTax = page.locator('[data-test="tax-label"]');
    this.cartItems = page.locator('.cart_item');

    // Complete
    this.confirmationHeader = page.locator('[data-test="complete-header"]');
    this.confirmationText = page.locator('[data-test="complete-text"]');
    this.backHomeButton = page.locator('[data-test="back-to-products"]');
    this.ponyExpressImage = page.locator('[data-test="pony-express"]');
  }

  // ── Actions ──────────────────────────────────────────────

  async fillShippingInfo(firstName: string, lastName: string, zipCode: string): Promise<void> {
    await this.fillField(this.firstNameInput, firstName);
    await this.fillField(this.lastNameInput, lastName);
    await this.fillField(this.zipCodeInput, zipCode);
  }

  async continue(): Promise<void> {
    await this.clickElement(this.continueButton);
  }

  async finish(): Promise<void> {
    await this.clickElement(this.finishButton);
  }

  async cancel(): Promise<void> {
    await this.clickElement(this.cancelButton);
  }

  async backToProducts(): Promise<void> {
    await this.clickElement(this.backHomeButton);
  }

  // ── Assertions ───────────────────────────────────────────

  async assertOnStepOne(): Promise<void> {
    await this.assertVisible(this.firstNameInput, 'First name input should be visible on checkout step one');
    await this.assertUrlContains(ROUTES.CHECKOUT_STEP_ONE);
  }

  async assertOnStepTwo(): Promise<void> {
    await this.assertVisible(this.finishButton, 'Finish button should be visible on checkout step two');
    await this.assertUrlContains(ROUTES.CHECKOUT_STEP_TWO);
  }

  async assertOnComplete(): Promise<void> {
    await this.assertVisible(this.confirmationHeader, 'Confirmation header should be visible on complete page');
    await this.assertUrlContains(ROUTES.CHECKOUT_COMPLETE);
  }

  async assertConfirmationHeader(text: string): Promise<void> {
    await this.assertText(this.confirmationHeader, text);
  }

  async assertErrorMessage(message: string): Promise<void> {
    await this.assertText(this.errorMessage, message);
  }

  async assertItemInSummary(productName: string): Promise<void> {
    await this.assertVisible(
      this.cartItems.filter({ hasText: productName }),
      `"${productName}" should appear in the order summary`
    );
  }

  async assertTotalVisible(): Promise<void> {
    await this.assertVisible(this.summaryTotal, 'Order total should be visible');
  }
}
