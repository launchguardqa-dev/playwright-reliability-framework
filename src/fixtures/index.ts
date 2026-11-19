import { test as base } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { InventoryPage } from '../pages/InventoryPage';
import { CartPage } from '../pages/CartPage';
import { CheckoutPage } from '../pages/CheckoutPage';
import { ProductDetailPage } from '../pages/ProductDetailPage';
import { NavigationPage } from '../pages/NavigationPage';
import { USERS } from '../constants/credentials';

type PageFixtures = {
  loginPage: LoginPage;
  inventoryPage: InventoryPage;
  cartPage: CartPage;
  checkoutPage: CheckoutPage;
  productDetailPage: ProductDetailPage;
  navigationPage: NavigationPage;
  authenticatedInventoryPage: InventoryPage;
  authenticatedNavigationPage: NavigationPage;
};

/**
 * Page fixtures only construct page objects; they never navigate.
 * A fixture that navigates during setup can silently satisfy a test's
 * own assertions (e.g. a logout test "landing" on a login page the
 * fixture already loaded). Navigation belongs in the test or in the
 * explicit authenticated* fixtures below.
 */
export const test = base.extend<PageFixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  inventoryPage: async ({ page }, use) => {
    await use(new InventoryPage(page));
  },

  cartPage: async ({ page }, use) => {
    await use(new CartPage(page));
  },

  checkoutPage: async ({ page }, use) => {
    await use(new CheckoutPage(page));
  },

  productDetailPage: async ({ page }, use) => {
    await use(new ProductDetailPage(page));
  },

  navigationPage: async ({ page }, use) => {
    await use(new NavigationPage(page));
  },

  /**
   * Pre-authenticated fixture — logs in as standard user.
   * Use for any test that isn't about the login flow itself.
   */
  authenticatedInventoryPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(USERS.STANDARD.username, USERS.STANDARD.password);

    const inventoryPage = new InventoryPage(page);
    await inventoryPage.assertOnInventoryPage();
    await use(inventoryPage);
  },

  /**
   * Pre-authenticated fixture returning NavigationPage.
   * Use for menu and navigation tests.
   */
  authenticatedNavigationPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(USERS.STANDARD.username, USERS.STANDARD.password);
    await new InventoryPage(page).assertOnInventoryPage();

    await use(new NavigationPage(page));
  },
});

export { expect } from '@playwright/test';
