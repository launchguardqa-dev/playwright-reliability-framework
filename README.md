# playwright-reliability-framework

> Enterprise-grade Playwright + TypeScript automation framework built for reliability, scalability, and CI stability.

[![Playwright Tests](https://github.com/launchguardqa-dev/playwright-reliability-framework/actions/workflows/playwright.yml/badge.svg)](https://github.com/launchguardqa-dev/playwright-reliability-framework/actions/workflows/playwright.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![Playwright](https://img.shields.io/badge/Playwright-1.44-green)
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
await page.getByRole('button', { name: 'Submit Order' }).click();

// Retries on CI absorb genuine transient flakiness (playwright.config.ts)
retries: process.env.CI ? 2 : 0,
```

**Why this holds up:**
- Explicit waits target the actual state you care about, so tests are exactly as fast as the app allows — no more, no less
- Locators based on role and accessible name survive redesigns because they describe *intent*, not DOM position
- CI-only retries catch real transient issues without hiding systematic bugs — if a test needs 3 attempts, that's a signal, not a fluke to ignore

### The result

| | Before | After |
|---|---|---|
| Flaky failure rate | High, inconsistent | Near-zero, predictable |
| Debugging a failure | Guesswork | Trace + screenshot + video attached automatically |
| Trust in CI | "Just re-run it" | Red means broken |
| Onboarding a new engineer | Tribal knowledge | Page Object Model — self-documenting |

---

## Tech Stack

| Tool | Version | Purpose |
|---|---|---|
| [Playwright](https://playwright.dev) | ^1.44 | Browser automation |
| [TypeScript](https://typescriptlang.org) | ^5.4 | Type safety |
| [GitHub Actions](https://github.com/features/actions) | — | CI/CD pipeline |
| [dotenv](https://npmjs.com/package/dotenv) | ^16.4 | Environment config |

---

## Project Structure

```
playwright-reliability-framework/
├── src/
│   ├── pages/              # Page Object Models
│   │   ├── BasePage.ts     # Shared helpers (fill, click, assert, wait)
│   │   ├── LoginPage.ts
│   │   ├── InventoryPage.ts
│   │   └── CartPage.ts
│   ├── fixtures/
│   │   └── index.ts        # Custom test fixtures (DI for Page Objects)
│   └── constants/
│       ├── routes.ts       # URL paths
│       └── credentials.ts  # Test users (env-driven)
├── tests/
│   ├── auth/
│   │   └── login.spec.ts   # Login / auth flows
│   ├── cart/
│   │   └── cart.spec.ts    # Cart behavior
│   └── smoke/              # @smoke tag docs
├── reports/                # HTML report output (gitignored)
├── .github/
│   └── workflows/
│       └── playwright.yml  # CI pipeline with smoke gate
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
npm test -- --grep @smoke

# Single browser
npm test -- --project=chromium

# Specific folder
npm run test:auth
npm run test:cart

# Headed (see the browser)
npm run test:headed

# Debug mode
npm run test:debug
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

The GitHub Actions workflow (`playwright.yml`) runs on every push and pull request.

**Full suite** runs on `main` and `develop` branches across Chromium and Firefox in parallel.

**Smoke gate** runs on every pull request — Chromium only, `@smoke`-tagged tests. PRs must pass the smoke gate before merge.

Artifacts uploaded on every run:
- HTML report (14-day retention)
- Test results folder on failure (7-day retention)

---

## Architecture Decisions

### Page Object Model
Every screen is a class. Locators are defined once. Tests call methods, not selectors. When the UI changes, you fix it in one place.

### Custom Fixtures
Page Objects are injected as fixtures — tests declare what they need, Playwright handles setup and teardown. The `authenticatedInventoryPage` fixture handles login once so cart tests don't repeat it.

### Smoke Tags
Critical-path tests are tagged `@smoke`. They run in under 30 seconds and act as the pre-deploy release gate. Adding a test to smoke is one word: append `@smoke` to the test title.

### Environment-First Config
`BASE_URL`, credentials, and CI flags come from environment variables. No hardcoded values. The same test suite runs against staging or production by changing one variable.

### Retry Strategy
`retries: 2` on CI only. Zero retries locally — you should see real failures. On CI, two retries absorb genuine transient flakiness without hiding systematic problems. Failures that require 3 attempts are bugs.

---

## License

MIT — use it, fork it, adapt it.

---

*Built by [LaunchGuard QA](mailto:launchguard.qa@gmail.com) — helping engineering teams ship with confidence.*
