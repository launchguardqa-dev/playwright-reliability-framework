import { test, expect } from '../../src/fixtures';
import { LoginPage } from '../../src/pages/LoginPage';

/**
 * Navigation Tests
 *
 * Covers: burger menu, logout, auth guard (accessing protected
 * routes without being logged in), and menu link behavior.
 */
test.describe('Navigation & Menu', () => {

  test('should open burger menu', async ({ authenticatedNavigationPage }) => {
    await authenticatedNavigationPage.openMenu();
    await authenticatedNavigationPage.assertMenuOpen();
  });

  test('should close burger menu', async ({ authenticatedNavigationPage }) => {
    await authenticatedNavigationPage.openMenu();
    await authenticatedNavigationPage.assertMenuOpen();
    await authenticatedNavigationPage.closeMenu();
    await authenticatedNavigationPage.assertMenuClosed();
  });

  test('should log out successfully @smoke', async ({ page, authenticatedNavigationPage }) => {
    const loginPage = new LoginPage(page);

    await authenticatedNavigationPage.logout();

    await loginPage.assertOnLoginPage();
    await authenticatedNavigationPage.assertUrlContains('/');
  });

  test('should redirect to login when accessing inventory without auth', async ({ page }) => {
    const loginPage = new LoginPage(page);

    await page.goto('/inventory.html');

    await loginPage.assertOnLoginPage();
  });

  test('should redirect to login when accessing cart without auth', async ({ page }) => {
    const loginPage = new LoginPage(page);

    await page.goto('/cart.html');

    await loginPage.assertOnLoginPage();
  });

  test('should redirect to login when accessing checkout without auth', async ({ page }) => {
    const loginPage = new LoginPage(page);

    await page.goto('/checkout-step-one.html');

    await loginPage.assertOnLoginPage();
  });

  test('should navigate to all items from menu', async ({ page, authenticatedNavigationPage }) => {
    // First go to cart, then use menu to go back to inventory
    await authenticatedNavigationPage.goToCart();
    await authenticatedNavigationPage.assertUrlContains('/cart.html');

    await authenticatedNavigationPage.goToAllItems();
    await authenticatedNavigationPage.assertUrlContains('/inventory.html');
  });

  test('should not be able to go back to inventory after logout', async ({ page, authenticatedNavigationPage }) => {
    const loginPage = new LoginPage(page);

    await authenticatedNavigationPage.logout();
    await page.goBack();

    // Should still be on login page or redirected back
    await loginPage.assertOnLoginPage();
  });

  test('should reset app state and clear cart', async ({ page, authenticatedNavigationPage }) => {
    // Add items to cart first
    await page.goto('/inventory.html');
    await page.locator('[data-test="add-to-cart-sauce-labs-backpack"]').click();
    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('1');

    // Reset via menu
    await authenticatedNavigationPage.resetAppState();

    // Cart badge should be gone
    await expect(page.locator('[data-test="shopping-cart-badge"]')).toBeHidden();
  });
});
