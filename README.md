# playwright-reliability-framework

> A Playwright + TypeScript automation framework built for reliability, maintainability, and CI stability. 91 tests across auth, cart, checkout, product, sorting, and navigation flows, a bug-detection matrix that proves the checks catch real defects, and LaunchGuard Scout, an automated QA scanner for any site. Gated by lint and typecheck in CI.

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

### A Real App Race Condition, Found in Slow Motion

**Symptom.** Running the suite in slow motion (`SLOW_MO=500`), the burger-menu tests failed intermittently: the click succeeded, but the menu never opened. The failure snapshot showed a contradiction. The menu said it was open (`aria-hidden="false"`) but was still `hidden="true"`.

**Root cause (in the app, not the tests).** On page load, the menu component starts a 500ms timer that adds `hidden` to the menu. Clicking the burger removes `hidden` and then flips the state to "open" on the next tick, which is supposed to cancel that timer. A click that lands right around the 500ms mark lets the timer fire in between: `hidden` is re-added after the menu is already marked open, so the menu is stuck. Slow motion added about 500ms before each click, which landed it right in that window.

**Proof.** A script that clicks at controlled delays after page load reproduced it **6/6 at ~450ms** and 0/6 at every other delay.

**Fix.** `NavigationPage.openMenu()` waits for the menu's settled closed state (`.bm-menu-wrap[hidden]` present) before clicking. That's a wait on a real condition, not a sleep. After the fix: **0/6** stuck at the same 450ms delay. The full slow-motion suite also passes again.

**Takeaway.** A real user who clicks the menu about half a second after the page loads hits this same bug. Varying test timing (slow motion, a different machine) is a cheap way to shake out race conditions that a fast, consistent CI run never sees.

---

## LaunchGuard Scout: Automated QA Scan for Any Site

Scout scans a website and produces an evidence-backed QA report. It has two layers:

1. **A deterministic scanner** (`scout/`, TypeScript + Playwright) that crawls the site and runs the same checks every time:

   | Check | What it finds |
   |---|---|
   | HTTP status | Pages and links that return errors |
   | JavaScript | Uncaught exceptions and console errors |
   | Network | Failed requests to the site and to third parties |
   | Images | Images that fail to load, "not found" placeholders, one file reused for many different items |
   | Accessibility | WCAG 2.1 AA violations via axe-core |
   | Mobile | Pages that scroll sideways at phone width (with a screenshot) |
   | Performance | Slow page loads and slow logins |

2. **An AI layer:** the `/qa-run` Claude Code skill (`.claude/skills/qa-run/`) runs the scanner, verifies heuristic findings against screenshots, merges findings that share a root cause, and writes a plain-language `qa-summary.md` ranked by user impact.

```bash
# Scan any site you're authorized to test
npm run scout -- https://example.com --authorized

# Scan SauceDemo as a specific user (profile handles login and SPA routes)
npm run scout -- --profile scout/profiles/saucedemo.json --authorized --username problem_user
```

Output goes to `scout-reports/<host>-<timestamp>/`: `report.html` (light/dark, mobile-friendly), `findings.json`, and screenshots. Add `--fail-on high` to use it as a CI gate.

**Safety rules, enforced in code:** it refuses to run without `--authorized`; it stays on the target's origin; it's read-only (it never clicks or submits anything except login steps you configure); and it's polite (15-page limit, 750ms between loads).

**Every finding carries a confidence level:** *confirmed* (directly observed), *likely* (strong signal, like an axe violation), or *heuristic* (a pattern worth a human look). Heuristics are labeled as such, never presented as fact.

### Scout's own tests

`tests/scout/` runs Scout against a local fixture site with **one planted bug per check** and a **clean control page that must produce zero findings**. To prove the tests can fail, two checks were deliberately sabotaged: disabling the image check failed the image test, and calling every page "slow" failed the clean-page test. Each sabotage was caught by exactly the test meant to catch it.

### False positives found and fixed on real sites

Running Scout on SauceDemo surfaced two false positives before release. Both were fixed by making the finding accurate, not by hiding it:
- **SPA routes served with HTTP 404.** SauceDemo's server answers 404 for routes like `/cart.html`, but the browser renders them normally. Scout first called these "broken links". It now reports them as one low-severity *"renders normally but returns an HTTP error status"* finding, which is still worth knowing because search engines treat those pages as missing.
- **Cancelled requests.** Image loads cancelled when Scout moved to the next page (`ERR_ABORTED`) were reported as failures. Cancellations are now ignored; real failures (4xx/5xx, DNS, refused connections) still count.

### What it found on SauceDemo

| User | Scout's findings |
|---|---|
| `standard_user` | Only the accurate low-severity 404-status note (no false alarms) |
| `problem_user` | All 6 product images are "not found" placeholders sharing one file |
| `visual_user` | The Backpack image is a "not found" placeholder |
| `performance_glitch_user` | Slow login (5.2s) |
| `error_user` | **"This component failed to render!" on product detail pages.** The screenshot confirms the product description is missing. Neither manual exploration nor the 82-test suite had caught this. |

---

## Do These Tests Actually Catch Bugs?

A suite that only ever passes can't tell you whether it would notice a broken app. SauceDemo ships deliberately broken accounts that log in normally and then misbehave, so `tests/users/user-variants.spec.ts` runs the **same 8 checks against all of them**:

| Check | standard | problem | error | perf. glitch | visual |
|---|:-:|:-:|:-:|:-:|:-:|
| Product images load | ✅ | 🐞 | ✅ | ✅ | 🐞 |
| Prices match the catalog | ✅ | ✅ | ✅ | ✅ | 🐞 |
| Sort by name Z→A | ✅ | 🐞 | 🐞 | ✅ | ✅ |
| Sort by price low→high | ✅ | 🐞 | 🐞 | ✅ | 🐞 |
| Add every product to cart | ✅ | 🐞 | 🐞 | ✅ | ✅ |
| Remove products from cart | ✅ | 🐞 | 🐞 | ✅ | ✅ |
| Checkout form keeps typed values | ✅ | 🐞 | 🐞 | ✅ | ✅ |
| Complete an order | ✅ | 🐞 | 🐞 | ✅ | ✅ |

✅ must pass · 🐞 known bug, caught by the check

**How it works:**
- **`standard_user` is the control.** Every check must pass there, which proves the check itself is valid. A check that also "fails" on a working app proves nothing.
- **Each known-bug test asserts two things:**
  1. **The normal check fails.** This proves it catches the bug.
  2. **The page shows that bug's exact signature.** For example, `problem_user`'s first-name field contains the *last* name, while `error_user`'s last-name handler throws `Cannot read properties of undefined (reading 'value')`.

  Step 2 is what makes it strict. A bare `test.fail()` accepts *any* failure, so a site outage or a renamed button would still count as "bug caught." Here, if the bug is fixed, changes shape, or something unrelated breaks, the signature no longer matches and the test fails. CI stays green only while each bug behaves exactly as documented.
- **`performance_glitch_user` must pass everything** despite a ~5s login and ~5s sorts. That only works because every wait is condition-based.
- **Fail fast, never flaky.** Checks expected to fail use a 5s assertion timeout; working checks get 15s, so slow-but-correct behavior never trips them.
- **Every bug was observed on the live site before writing tests** (3 runs per user), not copied from documentation.

**Proving the strictness works (mutation test).** A temporary copy of the spec paired each bug list with the *wrong* user: `problem_user`'s bugs against `error_user` (same broken features, different symptoms), the reverse, and `visual_user`'s bugs against `standard_user` (simulating "bug fixed"). **All 16 mismatched tests failed.** A `test.fail()`-only version would have missed 12 of the 16, because the features were still broken, just differently.

**What it caught during development:**
- A crash in test code being counted as a "caught bug".
- A price-order check that could pass on a partial mid-render read.
- An exploration gap: `error_user` throws an error while *typing* the last name (the real cause of the dropped field), not just on Finish. The strict signature failed until it described the actual behavior.

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
│   ├── users/user-variants.spec.ts # 8 checks × 5 users: proves checks catch bugs (40)
│   ├── scout/                    # Scout's own tests against a planted-bug fixture site (9)
│   └── smoke/                    # @smoke tag docs
├── scout/                        # LaunchGuard Scout scanner (crawl, checks, report, CLI, profiles)
├── .claude/skills/qa-run/        # /qa-run Claude Code skill: AI triage on top of Scout
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
npm run test:auth        # also: test:cart, test:checkout, test:navigation, test:product, test:sorting, test:users

# Flake check — every test 10x on Chromium, retries off
npm run test:flake-check

# Headed (see the browser)
npm run test:headed

# Watch it run: installed Google Chrome, one test at a time
npm run test:watch
# ...in slow motion (PowerShell: $env:SLOW_MO=500; npm run test:watch)
SLOW_MO=500 npm run test:watch

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
