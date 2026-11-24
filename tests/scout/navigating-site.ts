import * as http from 'http';
import { AddressInfo } from 'net';
import { LoggedRequest } from './fixture-site';

/**
 * A city site whose directory page navigates on its own after loading, like the
 * CivicPlus "directory.aspx" that crashed a live scan ("Execution context was destroyed").
 *
 * To make the timing deterministic, /directory navigates the moment Scout's accessibility
 * checker is injected (window.axe appears), so the navigation always lands in the middle
 * of Scout's analysis rather than "probably" during it.
 */

export type NavKind =
  | 'redirect-elsewhere' // /directory → /directory/results (a different, real page)
  | 'reload-loop'        // /directory reloads itself every time it's checked
  | 'redirect-home';     // /directory → / (a page already scanned)

const ON_AXE = (action: string) => `<script>
  var t = setInterval(function () { if (window.axe) { clearInterval(t); ${action} } }, 5);
</script>`;

const page = (title: string, body: string) =>
  '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body>`
  + `<header><nav aria-label="Main">
       <a href="/directory">Staff directory</a> <a href="/news">News</a> <a href="/contact">Contact</a>
     </nav></header><main><h1>${title}</h1>${body}</main></body></html>`;

export async function startNavigatingSite(kind: NavKind): Promise<{ origin: string; requests: LoggedRequest[]; close: () => Promise<void> }> {
  const requests: LoggedRequest[] = [];
  const actions: Record<NavKind, string> = {
    'redirect-elsewhere': "location.replace('/directory/results');",
    'reload-loop': 'location.reload();',
    'redirect-home': "location.replace('/');",
  };
  const pages: Record<string, string> = {
    // Each real page has one distinct accessibility problem, so its findings are recognizable.
    '/': page('City Home', '<p>Welcome to the city.</p><img src="/seal.png" width="40" height="40">'),
    '/news': page('News', '<p>Council approved the budget.</p><label>Search news</label><input type="search">'),
    '/contact': page('Contact', '<p>City Hall, 1 Civic Center Drive.</p>'),
    '/directory': page('Staff Directory', `<p>Loading directory…</p>${ON_AXE(actions[kind])}`),
    '/directory/results': page('Staff Directory Results', '<p>Clerk, Planning, Public Works.</p><button><svg aria-hidden="true" width="8" height="8"></svg></button>'),
  };

  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    requests.push({ method: req.method ?? 'GET', path, at: Date.now(), userAgent: String(req.headers['user-agent'] ?? ''), from: req.headers.from as string | undefined });
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('User-agent: *\nDisallow:\n');
    } else if (path === '/seal.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
    } else if (pages[path]) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(pages[path]);
    } else {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<!doctype html><html lang="en"><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1></body></html>');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, requests, close: () => new Promise((resolve) => server.close(() => resolve())) };
}
