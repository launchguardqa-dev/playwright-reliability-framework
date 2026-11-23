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
  | 'performance'
  | 'pdf';

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
  /** WCAG 2.x success criteria this finding relates to, e.g. ["1.1.1"]. */
  wcag?: string[];
  /**
   * Set when the problem comes from third-party content (an embedded YouTube player,
   * a map, a social widget, an outside script): the host it belongs to. The site owner
   * is still responsible for what it embeds, but these are reported separately from
   * the site's own issues.
   */
  thirdParty?: string;
}

/** What Scout learned about one PDF document. */
export interface PdfResult {
  url: string;
  /** HTML pages that link to this PDF. */
  linkedFrom: string[];
  /** Size from Content-Length, when the server reports it. */
  bytes?: number;
  /** False when only metadata was fetched (public scan) or the file was skipped. */
  analyzed: boolean;
  skippedReason?: string;
  pages?: number;
  /** Tagged = has a structure tree AND MarkInfo/Marked is true. */
  tagged?: boolean;
  title?: string;
  lang?: string;
  /** full: every page has text · partial: some pages are image-only · none: scanned · empty: no content. */
  textLayer?: 'full' | 'partial' | 'none' | 'empty';
  /** Pages with images but no fonts (likely scanned). */
  imageOnlyPages?: number;
  encrypted?: boolean;
  error?: string;
}

export type ScanMode = 'authorized' | 'public';

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
  /**
   * authorized (default): you have permission; full crawl, PDFs downloaded and analyzed.
   * public: no permission; strictly limited sample of what any visitor sees (see crawl.ts).
   */
  mode?: ScanMode;
  /** Contact email sent in the User-Agent and From header. Required for public scans. */
  contact?: string;
  /** Max PDFs to download and analyze in authorized mode (default 20). */
  maxPdfs?: number;
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
  mode: ScanMode;
  /** PDF documents linked from the scanned pages. */
  pdfs: PdfResult[];
  /** robots.txt handling (public scans always check it). */
  robots?: { checked: boolean; skipped: string[] };
  /** URLs skipped or dropped because they are the same page as one already scanned. */
  duplicates?: { url: string; duplicateOf: string; reason: string }[];
}
