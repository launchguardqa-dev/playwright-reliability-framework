# playwright-reliability-framework

> A Playwright + TypeScript automation framework built for reliability, maintainability, and CI stability. 42 tests across auth, cart, checkout, product, sorting, and navigation flows, gated by lint and typecheck in CI.

[![Playwright Tests](https://github.com/launchguardqa-dev/playwright-reliability-framework/actions/workflows/playwright.yml/badge.svg)](https://github.com/launchguardqa-dev/playwright-reliability-framework/actions/workflows/playwright.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![Playwright](https://img.shields.io/badge/Playwright-1.60-green)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Why This Framework Exists

Most Playwright setups start clean and become unmaintainable. Tests break on every deploy, CI pipelines turn red for reasons nobody understands, and "just retry it" becomes the team's debugging strategy.

This framework is built around the opposite philosophy:

- **Reliability by default** — retries, stable locators, explicit waits, no implicit sleeps
- **Failure visibility** — traces, screenshots, and HTML reports captured on every failure
- **CI-first design** — runs consistently in GitHub Actions without flake-masking hacks
- **Scalable architecture** — Page Object Model + custom fixtures keep tests maintainable as the suite grows

---

## Problems This Framework Solves

Most Playwright suites start clean and become unreliable within a few months. Here's what typically goes wrong — and how this framework avoids it.

### ❌ Before: Flaky, hard-to-debug automation

```typescript
// Arbitrary waits mask real timing issues instead of fixing them
await page.waitForTimeout(5000);

// Brittle locator breaks the moment the DOM structure shifts
await page.locator('div:nth-child(4) > button').click();

// No retry strategy — one network blip fails the whole CI run
await page.click('#submit');
```

**What goes wrong in production:**
- `waitForTimeout` guesses at timing instead of waiting for the actual condition — tests pass locally on a fast machine and fail in CI on a slower runner
- `nth-child` selectors break the moment someone reorders elements or a designer tweaks the layout
- No retry strategy means a single transient network hiccup fails the entire pipeline, and nobody trusts the "red" build enough to investigate

### ✅ After: The LaunchGuard approach

```typescript
// Wait for the actual condition, not a guess at timing
await expect(page.locator('[data-test="submit"]')).toBeEnabled();

// Stable, semantic locator — survives layout and DOM changes
await page.locator('[data-test="finish"]').click();

// Retries on CI absorb genuine transient flakiness (playwright.config.ts)
retries: process.env.CI ? 2 : 0,
```

**Why this holds up:**
- Explicit waits target the actual state you care about, so tests are exactly as fast as the app allows — no more, no less
- Locators based on dedicated `data-test` attributes survive redesigns because they are a contract with the app, not a description of DOM position
- CI-only retries catch real transient issues without hiding systematic bugs — if a test needs 3 attempts, that's a signal, not a fluke to ignore

### The result

| | Before | After |
|---|---|---|
| Flaky failure rate | High, inconsistent | Near-zero, predictable |
| Debugging a failure | Guesswork | Trace + screenshot + video attached automatically |
| Trust in CI | "Just re-run it" | Red means broken |
| Onboarding a new engineer | Tribal knowledge | Page Object Model — self-documenting |

---

## Reliability in Practice: a Real Flake, Found and Fixed

This framework had a flaky test of its own, which is a good example of how these rules work in practice.

**Symptom.** The product detail tests passed in CI but failed intermittently on a faster local machine, and a different subset failed on each run.

**Root cause.** The detail page reuses data-test ids from the inventory list (`inventory-item-name`), and the "Add to cart" locator used a prefix match (`[data-test^="add-to-cart"]`). After clicking a product, the test queried the page before navigation finished, so the locator matched all six buttons still on the list. Playwright's strict mode correctly refused to guess.

**Fix.**
- `InventoryPage.openProduct()` clicks and then waits for the detail URL, so every test enters the page the same way.
- Detail-page locators use the exact ids (`add-to-cart`, `remove`), which exist only on that page.
- `assertOnDetailPage()` checks the URL first and asserts exactly one product name.

**Proof.** `npm run test:flake-check` runs the suite 10× with retries off. That's 420 runs with zero failures after the fix.

**Guardrails added so it stays fixed.**
- ESLint fails on any un-awaited promise (`no-floating-promises`), the most common cause of Playwright flakiness, and bans hard sleeps (`waitForTimeout`).
- Lint and typecheck run as a CI gate before any browser starts.
- Page fixtures never navigate during setup. A fixture that loads the login page can silently make a logout test pass.
- Exact path assertions (`assertPathIs('/')`) replace "URL contains `/`", which could never fail.

---

## Tech Stack

| Tool | Version | Purpose |
|---|---|---|
| [Playwright](https://playwright.dev) | ^1.44 (locked 1.60) | Browser automation |
| [TypeScript](https://typescriptlang.org) | ^5.4 | Type safety (`strict`) |
| [ESLint](https://eslint.org) + [eslint-plugin-playwright](https://github.com/playwright-community/eslint-plugin-playwright) | 8.x / 1.x | Reliability-focused linting |
| [GitHub Actions](https://github.com/features/actions) | — | CI/CD pipeline |
| [dotenv](https://npmjs.com/package/dotenv) | ^16.4 | Environment config |

---

## Project Structure

```
playwright-reliability-framework/
├── src/
│   ├── pages/                    # Page Object Models
│   │   ├── BasePage.ts           # Shared helpers (fill, click, assert, wait)
│   │   ├── LoginPage.ts
│   │   ├── InventoryPage.ts
│   │   ├── ProductDetailPage.ts
│   │   ├── CartPage.ts
│   │   ├── CheckoutPage.ts       # All three checkout steps
│   │   └── NavigationPage.ts     # Burger menu, logout, reset
│   ├── fixtures/
│   │   └── index.ts              # Custom fixtures (DI for Page Objects)
│   └── constants/
│       ├── routes.ts             # URL paths
│       ├── credentials.ts        # Test users (env-driven)
│       └── checkout.ts           # Products, shipping data, error copy
├── tests/
│   ├── auth/login.spec.ts        # Login and error states (7)
│   ├── cart/cart.spec.ts         # Cart behavior (6)
│   ├── checkout/checkout.spec.ts # Purchase flow, validation, cancel (8)
│   ├── navigation/navigation.spec.ts # Menu, logout, auth guards (9)
│   ├── product/product.spec.ts   # Product detail page (6)
│   ├── sorting/sorting.spec.ts   # Sort order data integrity (6)
│   └── smoke/                    # @smoke tag docs
├── reports/                      # HTML report output (gitignored)
├── .github/workflows/
│   └── playwright.yml            # Lint/typecheck gate, browser matrix, smoke gate
├── .eslintrc.cjs                 # Reliability-focused lint rules
├── .env.example
├── playwright.config.ts
└── tsconfig.json
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Install

```bash
git clone https://github.com/launchguardqa-dev/playwright-reliability-framework.git
cd playwright-reliability-framework

npm install
npx playwright install
```

### Configure environment

```bash
cp .env.example .env
# Edit .env if targeting a different environment
```

---

## Running Tests

```bash
# Full suite (all browsers)
npm test

# Smoke tests only — the fast CI gate
npm run test:smoke

# Single browser
npm test -- --project=chromium

# Specific folder
npm run test:auth        # also: test:cart, test:checkout, test:navigation, test:product, test:sorting

# Flake check — every test 10x on Chromium, retries off
npm run test:flake-check

# Headed (see the browser)
npm run test:headed

# Debug mode
npm run test:debug

# Static checks (same as the CI gate)
npm run lint
npm run typecheck
```

---

## Reporting

HTML reports are generated on every run and saved to `reports/html/`.

```bash
npm run test:report
```

On failure, Playwright captures:
- Screenshot of the failing state
- Video of the full test run
- Trace file for step-by-step debugging (open with `npx playwright show-trace`)

In CI, reports are uploaded as GitHub Actions artifacts and retained for 14 days.

---

## CI/CD Pipeline

The GitHub Actions workflow (`playwright.yml`) runs on pushes to `main`/`develop`, on pull requests to `main`, and manually from the Actions tab (pick any suite).

**Quality gate** runs first: ESLint and `tsc --noEmit`. No browser starts until it passes, so a missing `await` or a type error fails in about a minute instead of surfacing as a flaky UI test.

**Full suite** runs across Chromium and Firefox in parallel.

**Smoke gate** runs on every pull request: Chromium only, `@smoke`-tagged tests. It's designed to be set as a required status check before merge.

Artifacts uploaded on every run:
- HTML report (14-day retention)
- Test results folder on failure (7-day retention)

---

## Architecture Decisions

### Page Object Model
Every screen is a class. Locators are defined once. Tests call methods, not selectors. When the UI changes, you fix it in one place.

### Custom Fixtures
Page Objects are injected as fixtures — tests declare what they need, Playwright handles setup and teardown. Plain page fixtures only construct objects and never navigate, so setup can't accidentally satisfy a test's assertions. The `authenticatedInventoryPage` and `authenticatedNavigationPage` fixtures log in and confirm the landing page, so non-auth tests carry no login boilerplate.

### Smoke Tags
Critical-path tests are tagged `@smoke`. They run in under 30 seconds and act as the pre-deploy release gate. Adding a test to smoke is one word: append `@smoke` to the test title.

### Environment-First Config
`BASE_URL`, credentials, and CI flags come from environment variables, falling back to SauceDemo's public demo values. The same test suite runs against another environment by changing one variable.

### Retry Strategy
`retries: 2` on CI only. Zero retries locally — you should see real failures. On CI, two retries absorb genuine transient flakiness without hiding systematic problems. Failures that require 3 attempts are bugs.

---

## License

MIT — use it, fork it, adapt it.

---

*Built by [LaunchGuard QA](mailto:launchguard.qa@gmail.com) — helping engineering teams ship with confidence.*
