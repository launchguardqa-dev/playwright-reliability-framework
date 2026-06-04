import { test, expect } from '../../src/fixtures';
import { USERS, ERROR_MESSAGES } from '../../src/constants/credentials';
import { ROUTES } from '../../src/constants/routes';

/**
 * Authentication Tests
 *
 * Covers: successful login, failed login scenarios, error state behavior.
 * Tagged @smoke so the critical path can run independently in CI.
 */
test.describe('Authentication', () => {
  test('should log in successfully with valid credentials @smoke', async ({ loginPage, inventoryPage }) => {
    await loginPage.login(USERS.STANDARD.username, USERS.STANDARD.password);
    await inventoryPage.assertOnInventoryPage();
    await loginPage.assertUrlContains(ROUTES.INVENTORY);
  });

  test('should show error for locked out user', async ({ loginPage }) => {
    await loginPage.login(USERS.LOCKED.username, USERS.LOCKED.password);
    await loginPage.assertErrorVisible();
    await loginPage.assertErrorMessage(ERROR_MESSAGES.LOCKED_USER);
  });

  test('should show error for invalid credentials', async ({ loginPage }) => {
    await loginPage.login(USERS.INVALID.username, USERS.INVALID.password);
    await loginPage.assertErrorVisible();
    await loginPage.assertErrorMessage(ERROR_MESSAGES.INVALID_CREDENTIALS);
  });

  test('should show error when username is missing', async ({ loginPage }) => {
    await loginPage.login('', USERS.STANDARD.password);
    await loginPage.assertErrorVisible();
    await loginPage.assertErrorMessage(ERROR_MESSAGES.MISSING_USERNAME);
  });

  test('should show error when password is missing', async ({ loginPage }) => {
    await loginPage.login(USERS.STANDARD.username, '');
    await loginPage.assertErrorVisible();
    await loginPage.assertErrorMessage(ERROR_MESSAGES.MISSING_PASSWORD);
  });

  test('should dismiss error message when X button is clicked', async ({ loginPage }) => {
    await loginPage.login(USERS.INVALID.username, USERS.INVALID.password);
    await loginPage.assertErrorVisible();
    await loginPage.clearError();
    await expect(loginPage.errorMessage).toBeHidden();
  });

  test('should not navigate away from login page on failed login', async ({ loginPage }) => {
    await loginPage.login(USERS.INVALID.username, USERS.INVALID.password);
    await loginPage.assertOnLoginPage();
    await loginPage.assertUrlContains(ROUTES.LOGIN);
  });
});
