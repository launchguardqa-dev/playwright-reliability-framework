/**
 * LaunchGuard Scout: shared types.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * How sure Scout is that a finding is a real problem.
 * - confirmed: directly observed (an HTTP 500, a thrown JS error)
 * - likely:    strong signal, rarely wrong (an axe WCAG violation)
 * - heuristic: a pattern worth a human look (6 products sharing one image file)
 */
export type Confidence = 'confirmed' | 'likely' | 'heuristic';

export type Category =
  | 'http'
  | 'javascript'
  | 'network'
  | 'images'
  | 'links'
  | 'accessibility'
  | 'mobile'
  | 'performance';

export interface Finding {
  /** Stable rule id, e.g. "js-error" or "a11y:image-alt". */
  rule: string;
  title: string;
  severity: Severity;
  confidence: Confidence;
  category: Category;
  /** Pages where this finding appeared (deduplicated across the crawl). */
  pages: string[];
  /** Human-readable explanation, including concrete evidence. */
  detail: string;
  /** Optional samples: offending URLs, selectors, messages. */
  samples?: string[];
  /** Relative path to a screenshot in the report folder. */
  screenshot?: string;
  /** Link to documentation (axe rules). */
  helpUrl?: string;
}

export interface PageResult {
  url: string;
  status: number | null;
  loadMs: number;
  title: string;
  screenshot?: string;
  findings: Finding[];
}

export interface LoginStep {
  fill?: string;
  value?: string;
  click?: string;
}

export interface Profile {
  name: string;
  startUrl: string;
  /** Extra paths to scan. Single-page apps often have few crawlable <a href> links. */
  paths?: string[];
  /** Regex strings; matching URLs are never visited (e.g. logout). */
  exclude?: string[];
  login?: {
    url: string;
    /** Values may use {{username}} and {{password}} placeholders. */
    steps: LoginStep[];
    /** Selector that must appear after a successful login. */
    successSelector: string;
    username?: string;
    password?: string;
  };
}

export interface ScoutOptions {
  profile: Profile;
  maxPages: number;
  /** Politeness delay between page loads, in ms. */
  delayMs: number;
  outDir: string;
  username?: string;
  password?: string;
  /** Watch mode: a visible browser window with a slowdown per action (ms). */
  watch?: { slowMo: number };
  /** Called with progress messages. */
  log?: (message: string) => void;
}

export interface ScoutResult {
  target: string;
  profile: string;
  startedAt: string;
  durationMs: number;
  loginMs?: number;
  pages: PageResult[];
  /** Deduplicated across pages and sorted by severity. */
  findings: Finding[];
}
