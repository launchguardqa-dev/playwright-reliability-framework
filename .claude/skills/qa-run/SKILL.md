---
name: qa-run
description: Run a LaunchGuard Scout QA scan on a website and turn the raw findings into a prioritized, evidence-backed QA summary. Use when the user says "/qa-run <url>", "scan this site", "run Scout on ...", or asks for a QA audit of a web page they are authorized to test.
---

# /qa-run: LaunchGuard Scout QA run

You are running a QA pass for LaunchGuard QA. Scout's deterministic scanner does the
measuring; your job is to verify, prioritize, and explain. **Accuracy beats volume:** a
short report a client can trust is worth more than a long one with false alarms.

Arguments: a URL, or a profile name from `scout/profiles/` (for example `saucedemo`),
optionally followed by a username (for example `saucedemo problem_user`).

## 1. Authorization (always first)

Scanning a site you don't have permission to test can violate its terms or the law.

- Public practice sites built for testing (saucedemo.com, the-internet.herokuapp.com,
  example.com) are fine to scan.
- For any other site, ask the user to confirm they own it or have explicit permission
  **before running anything**.
- If they don't have permission, the only option is `--public-scan`: a 3-page, identified,
  robots.txt-respecting preview that never downloads documents. It needs a contact email
  from the user (`--contact`); never invent one or reuse one from elsewhere. Never pass
  `--authorized` for a site the user hasn't confirmed permission for: that flag is a
  statement of permission.
- Share public-scan findings only privately with the site owner, framed as an offer.
  Never mention lawsuits, demand letters or enforcement.

## 2. Run the scanner

```bash
npm run scout -- <url> --authorized --out scout-reports/<short-name>
# or, with a profile (login + extra paths):
npm run scout -- --profile scout/profiles/<name>.json --authorized --username <user> --out scout-reports/<short-name>
```

Defaults are polite (15 pages, 750ms between loads). Don't raise them without the user asking.

```bash
# No permission: limited public preview
npm run scout -- <url> --public-scan --contact <user's email> --out scout-reports/<short-name>
# Government agency (ADA Title II): add --report gov to either mode
npm run scout -- <url> --authorized --report gov --out scout-reports/<short-name>
```

For government reports, read the PDF table and remediation numbers in `findings.json`
(`pdfs`) and include them in the summary. Remind the user that the Title II dates in
`scout/report-gov.ts` should be checked against ada.gov before a report goes to a client.

## 3. Verify before you report

Read `scout-reports/<short-name>/findings.json`. For each finding:

- **confirmed / likely:** keep, but sanity-check that it describes a problem a real user
  or the business would care about.
- **heuristic:** verify it. Open the referenced screenshot with the Read tool, or check
  the page yourself if a browser tool is available. Mark each heuristic finding as either
  **Verified** (say what you saw) or **Needs human review** (say why you couldn't tell).
- Merge findings that share one root cause (for example, 6 placeholder images and
  "6 items share one image file" are the same bug).

Rules:
- Never invent a finding that isn't in the data or that you didn't directly observe.
- Never raise a severity without evidence. You may lower one, with a one-line reason.
- If something looks like a Scout false positive, say so plainly. Don't silently drop it.

## 4. Optional: explore key flows (only with a browser tool and permission)

The scanner only observes; it never clicks. If a browser tool is available (Playwright MCP
or a built-in browser) **and** the target is a demo, staging, or test environment the user
confirmed, exercise 2-3 core flows: sorting/filtering, add to cart, form validation.

Never: submit payment details, create real accounts, send messages or emails, delete
data, or submit forms on a production site. Report every exploratory finding with exact
reproduction steps and what you expected versus what happened.

## 5. Write the summary

Write `scout-reports/<short-name>/qa-summary.md`:

1. **Summary**: 2-3 sentences a non-technical client understands. Lead with the most
   important problem.
2. **Top issues**: ranked by user impact. For each: what's wrong, who it affects, evidence
   (page, screenshot path, sample), and steps to reproduce.
3. **Needs human review**: unverified heuristic findings and anything you're unsure about.
4. **Coverage**: pages scanned, what Scout checks (HTTP status, JS errors, failed requests,
   images, broken links, WCAG 2.1 AA via axe-core, mobile overflow, load time), and what
   it does **not** check (visual design, business logic it didn't exercise, pages behind
   flows it didn't reach, security).

Finish by telling the user where `report.html` and `qa-summary.md` are, and the top 1-3
issues in plain language.
