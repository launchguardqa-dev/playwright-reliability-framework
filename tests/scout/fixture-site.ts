import * as http from 'http';
import { AddressInfo } from 'net';
import { makePdf } from './pdf-fixtures';

/**
 * A tiny local website with exactly one planted bug per Scout check,
 * plus a clean control page that must produce zero findings.
 */

// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

const page = (title: string, body: string, opts: { lang?: boolean } = {}) =>
  `<!doctype html><html${opts.lang === false ? '' : ' lang="en"'}><head><meta charset="utf-8">`
  + `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>`
  + `<body><main><h1>${title}</h1>${body}</main></body></html>`;

export const PAGES: Record<string, string> = {
  '/': page('Fixture home', `
    <ul>
      <li><a href="/blocked/page.html">Disallowed by robots.txt</a></li>
      <li><a href="/docs/agenda.pdf">Agenda (PDF)</a></li>
      <li><a href="/documents.html">Documents</a></li>
      <li><a href="/clean.html">Clean page</a></li>
      <li><a href="/images.html">Images</a></li>
      <li><a href="/errors.html">Errors</a></li>
      <li><a href="/overflow.html">Overflow</a></li>
      <li><a href="/a11y.html">Accessibility</a></li>
      <li><a href="/slow.html">Slow</a></li>
      <li><a href="/missing.html">Missing page</a></li>
      <li><a href="/private.html">Private page</a></li>
      <li><a href="/beacons.html">Beacons</a></li>
      <li><a href="/a11y-more.html">More accessibility</a></li>
      <li><a href="/lazy.html">Lazy-loaded images</a></li>
    </ul>`),

  // Lazy loading, as seen live: every image starts on one placeholder (an inline 1x1 GIF, or
  // a shared blank.png) with its real, distinct address in a data attribute. Not a bug.
  '/lazy.html': page('Lazy-loaded images', `
    <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-src="/img/council.png" alt="Council meeting" width="40" height="40">
    <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-src="/img/park.png" alt="New park opening" width="40" height="40">
    <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-src="/img/roads.png" alt="Road work update" width="40" height="40">
    <img src="/img/blank.png" data-lazy="/img/slide1.png" alt="Farmers market" width="40" height="40">
    <img src="/img/blank.png" data-lazy="/img/slide2.png" alt="Library hours" width="40" height="40">
    <img src="/img/blank.png" data-lazy="/img/slide3.png" alt="Summer camps" width="40" height="40">
    <img src="/img/placeholder.gif" data-original="/img/staff.png" alt="Staff photo" width="40" height="40">`),

  // robots.txt disallows /blocked/. Clean, so it adds no findings when an authorized scan visits it.
  '/blocked/page.html': page('Blocked page', '<p>robots.txt asks crawlers not to visit this page.</p>'),

  // One PDF per planted problem (see PDF_FILES), plus a duplicate link and an accessible control.
  '/documents.html': page('Documents', `
    <ul>
      <li><a href="/docs/accessible.pdf">Accessible PDF (control)</a></li>
      <li><a href="/docs/agenda.pdf">Agenda again (duplicate link)</a></li>
      <li><a href="/docs/scanned.pdf">Scanned minutes</a></li>
      <li><a href="/DocumentCenter/View/12">Budget (CMS link without .pdf)</a></li>
      <li><a href="/docs/not-really.pdf">Broken PDF</a></li>
    </ul>`),

  // Same "missing label" rule as /a11y.html, but with a different number of elements.
  '/a11y-more.html': page('More accessibility', `
    <input type="text">
    <input type="email">`),

  // Three requests to one failing endpoint, differing only in the query string.
  '/beacons.html': page('Beacons', `
    <p>Sends analytics beacons with a timestamp, like real tracking scripts do.</p>
    <script>
      fetch('/api/beacon?t=1'); fetch('/api/beacon?t=2'); fetch('/api/beacon?t=3');
      fetch('/api/me'); // session check: 401 for a signed-out visitor is expected
    </script>`),

  // Control: must produce no findings at all.
  '/clean.html': page('Clean page', `
    <p>Everything on this page is correct.</p>
    <img src="/img/ok.png" alt="A correct image" width="40" height="40">
    <label for="name">Name</label> <input id="name" type="text">`),

  '/images.html': page('Images', `
    <img src="/img/missing.png" alt="Broken image" width="40" height="40">
    <img src="/img/404-placeholder.png" alt="Placeholder image" width="40" height="40">
    <img src="/img/shared.png" alt="Red shirt" width="40" height="40">
    <img src="/img/shared.png" alt="Blue hat" width="40" height="40">
    <img src="/img/shared.png" alt="Green bag" width="40" height="40">`),

  '/errors.html': page('Errors', `
    <p>This page logs an error, requests a missing API and throws.</p>
    <script>
      console.error('Fixture console error');
      fetch('/api/missing');
      throw new Error('Fixture uncaught error');
    </script>`),

  '/overflow.html': page('Overflow', '<div style="width: 900px; background: #eee">Too wide for a phone</div>'),

  '/a11y.html': page('Accessibility', `
    <img src="/img/ok.png" width="40" height="40">
    <input type="text">`, { lang: false }),

  '/slow.html': page('Slow', '<p>This page takes over 3 seconds to respond.</p>'),
};

export const SLOW_PATH = '/slow.html';
export const SLOW_DELAY_MS = 3_300;
export const DEFAULT_ROBOTS = 'User-agent: *\nDisallow: /blocked/\n';

export interface LoggedRequest { method: string; path: string; userAgent: string; from?: string; at: number }

/** Starts the fixture site on a random free port. Every request is logged for assertions. */
export async function startFixtureSite(opts: { robots?: string } = {}): Promise<{
  origin: string;
  requests: LoggedRequest[];
  close: () => Promise<void>;
}> {
  // PDFs with known properties (see pdf-fixtures.ts).
  const PDF_FILES: Record<string, Uint8Array> = {
    '/docs/agenda.pdf': await makePdf({ pages: 3 }), // untagged, no title, no language
    '/docs/accessible.pdf': await makePdf({ pages: 2, title: 'Budget Summary', lang: 'en-US', tagged: true }),
    '/docs/scanned.pdf': await makePdf({ pages: 4, scanned: true }), // image-only, no text layer
    '/DocumentCenter/View/12': await makePdf({ pages: 5, lastPageScanned: true, title: 'Annual Budget', lang: 'en' }),
  };
  const requests: LoggedRequest[] = [];

  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    requests.push({
      method: req.method ?? 'GET', path, at: Date.now(),
      userAgent: String(req.headers['user-agent'] ?? ''),
      from: req.headers.from as string | undefined,
    });
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(opts.robots ?? DEFAULT_ROBOTS);
      return;
    }
    const pdf = PDF_FILES[path];
    if (pdf) {
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': pdf.byteLength });
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(pdf));
      return;
    }
    if (path === '/docs/not-really.pdf') {
      // A ".pdf" link that serves an HTML error page, as misconfigured CMSs do.
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(req.method === 'HEAD' ? undefined : '<html><body>Document temporarily unavailable</body></html>');
      return;
    }
    if (path === '/private.html') {
      // A sign-in wall: intended behavior, not a broken page.
      res.writeHead(401, { 'content-type': 'text/html', 'www-authenticate': 'Basic realm="fixture"' });
      res.end('Not authorized');
      return;
    }
    if (path === '/api/me') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end('{"message":"Unauthorized"}');
      return;
    }
    if (path === '/api/beacon') {
      res.writeHead(500);
      res.end();
      return;
    }
    if (path.startsWith('/img/') && path !== '/img/missing.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG);
      return;
    }
    const html = PAGES[path];
    if (!html) {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<!doctype html><html lang="en"><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1></body></html>');
      return;
    }
    const send = () => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html);
    };
    if (path === SLOW_PATH) setTimeout(send, SLOW_DELAY_MS);
    else send();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
