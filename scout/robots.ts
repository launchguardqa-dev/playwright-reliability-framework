/**
 * robots.txt support (RFC 9309), used by public scans.
 *
 * - Picks the group for Scout's own token if one exists, otherwise the "*" group.
 * - Longest matching rule wins; on a tie, Allow wins. Supports * and $ wildcards.
 * - Crawl-delay is honored when present (not in the RFC, but widely used).
 */

export const SCOUT_TOKEN = 'LaunchGuardScout';

interface Rule { allow: boolean; pattern: string }
export interface Robots {
  isAllowed(url: string): boolean;
  crawlDelaySeconds?: number;
  /** "absent" (404 etc.: allow all), "unreachable" (5xx/network: disallow all), or "parsed". */
  status: 'parsed' | 'absent' | 'unreachable';
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = body.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${regex}${anchored ? '$' : ''}`).test(path);
}

export function parseRobots(text: string, token = SCOUT_TOKEN): Robots {
  // Group lines into [agents, rules] blocks.
  const groups: { agents: string[]; rules: Rule[]; delay?: number }[] = [];
  let current: (typeof groups)[number] | undefined;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') {
      // An empty Disallow means "allow everything" and adds no rule.
      if (value) current.rules.push({ allow: key === 'allow', pattern: value });
    } else if (key === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.delay = n;
    }
  }

  const ours = token.toLowerCase();
  const group = groups.find((g) => g.agents.some((a) => a !== '*' && ours.includes(a)))
    ?? groups.find((g) => g.agents.includes('*'));
  const rules = group?.rules ?? [];

  return {
    status: 'parsed',
    crawlDelaySeconds: group?.delay,
    isAllowed(url: string) {
      const u = new URL(url);
      const path = decodeURIComponent(u.pathname) + u.search;
      let best: Rule | undefined;
      for (const rule of rules) {
        if (!matches(rule.pattern, path)) continue;
        if (!best || rule.pattern.length > best.pattern.length
          || (rule.pattern.length === best.pattern.length && rule.allow)) {
          best = rule;
        }
      }
      return best ? best.allow : true;
    },
  };
}

export const ALLOW_ALL: Robots = { status: 'absent', isAllowed: () => true };
/** Server errors mean "we can't know the rules", so a cautious crawler stays out. */
export const DISALLOW_ALL: Robots = { status: 'unreachable', isAllowed: () => false };

/** Fetches and parses robots.txt for an origin. */
export async function fetchRobots(
  get: (url: string) => Promise<{ status: number; text: string } | null>,
  origin: string,
): Promise<Robots> {
  const res = await get(`${origin}/robots.txt`);
  if (!res || res.status >= 500) return DISALLOW_ALL;
  if (res.status >= 400) return ALLOW_ALL; // 404/410 etc: no rules published
  return parseRobots(res.text);
}
