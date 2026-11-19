import { test } from '../../src/fixtures';
import { ROUTES } from '../../src/constants/routes';
import { PRODUCTS } from '../../src/constants/checkout';

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

  test('should log out successfully @smoke', async ({ authenticatedNavigationPage, loginPage }) => {
    await authenticatedNavigationPage.logout();

    await loginPage.assertOnLoginPage();
    await loginPage.assertPathIs(ROUTES.LOGIN);
  });

  const protectedRoutes = [
    { name: 'inventory', path: ROUTES.INVENTORY },
    { name: 'cart', path: ROUTES.CART },
    { name: 'checkout', path: ROUTES.CHECKOUT_STEP_ONE },
  ];

  for (const route of protectedRoutes) {
    test(`should redirect to login when accessing ${route.name} without auth`, async ({ page, loginPage }) => {
      await page.goto(route.path);

      await loginPage.assertOnLoginPage();
      await loginPage.assertPathIs(ROUTES.LOGIN);
    });
  }

  test('should navigate to all items from menu', async ({ authenticatedNavigationPage }) => {
    await authenticatedNavigationPage.goToCart();
    await authenticatedNavigationPage.assertPathIs(ROUTES.CART);

    await authenticatedNavigationPage.goToAllItems();
    await authenticatedNavigationPage.assertPathIs(ROUTES.INVENTORY);
  });

  test('should not be able to go back to inventory after logout', async ({ page, authenticatedNavigationPage, loginPage }) => {
    await authenticatedNavigationPage.logout();
    await page.goBack();

    await loginPage.assertOnLoginPage();
  });

  test('should reset app state and clear cart', async ({ authenticatedInventoryPage, navigationPage }) => {
    await authenticatedInventoryPage.addItemToCart(PRODUCTS.BACKPACK.dataTestId);
    await authenticatedInventoryPage.assertCartCount(1);

    await navigationPage.resetAppState();

    await authenticatedInventoryPage.assertCartCount(0);
  });
});
