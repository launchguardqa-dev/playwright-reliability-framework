/**
 * Detects bot-protection block pages (CDN / web application firewall), so Scout never
 * mistakes "Access Denied" for the site's own content.
 *
 * Why it matters: on a blocked site, every finding would describe the block page, not the
 * agency's website. A false WCAG finding against an agency is the worst thing Scout can
 * produce, so detection uses POSITIVE signals (known block-page signatures, statuses that
 * mean "go away") rather than guessing from the absence of words like "not found".
 */

export interface BlockSignal {
  /** Who is blocking, when recognizable (e.g. "Akamai"), or a generic description. */
  vendor: string;
}

/** Signatures of common block and challenge pages, checked against the title and visible text. */
const SIGNATURES: [RegExp, string][] = [
  [/attention required!? \| cloudflare|cloudflare ray id|\bcf-ray\b|cdn-cgi\/challenge-platform/i, 'Cloudflare'],
  [/^just a moment\.{3}|checking if the site connection is secure|checking your browser before accessing|enable javascript and cookies to continue/im, 'Cloudflare challenge'],
  [/reference\s*#\s*\d+\.[0-9a-f]+\.\d+\.[0-9a-f]+/i, 'Akamai'],
  [/incapsula incident id|request unsuccessful\. incapsula|_incapsula_resource/i, 'Imperva (Incapsula)'],
  [/sucuri website firewall|access denied - sucuri/i, 'Sucuri'],
  [/the requested url was rejected\. please consult with your administrator/i, 'F5 BIG-IP'],
  [/\brequest blocked\b|you have been blocked|blocked by (the )?(web application )?firewall|automated (access|requests?) (is|are) (not allowed|blocked)/i, 'web application firewall'],
];
/** Generic block-page titles (title only: these words are too common in body text). */
const GENERIC_TITLE = /^\s*(access denied|forbidden|403 forbidden|error 403|request rejected|unauthorized|401 unauthorized)\b/i;

/**
 * Is this response a block page rather than the site?
 *
 * @param isStart  the scan's start URL. A 401/403 there means Scout can't see the site at
 *                 all, so it counts as blocked even without a recognizable signature.
 */
export function detectBlock(status: number | null, title: string, text: string, isStart: boolean): BlockSignal | undefined {
  if (status === null || status < 400) return undefined;
  const haystack = `${title}\n${text.slice(0, 3000)}`;
  const vendor = SIGNATURES.find(([re]) => re.test(haystack))?.[1]
    ?? (GENERIC_TITLE.test(title) ? 'bot protection' : undefined);
  if (vendor) return { vendor };
  if (status === 429) return { vendor: 'rate limiting' };
  if (isStart && status === 401) return { vendor: 'sign-in required' };
  if (isStart && status === 403) return { vendor: 'access forbidden' };
  return undefined;
}
