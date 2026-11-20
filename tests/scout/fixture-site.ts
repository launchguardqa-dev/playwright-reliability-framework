import * as http from 'http';
import { AddressInfo } from 'net';

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
      <li><a href="/clean.html">Clean page</a></li>
      <li><a href="/images.html">Images</a></li>
      <li><a href="/errors.html">Errors</a></li>
      <li><a href="/overflow.html">Overflow</a></li>
      <li><a href="/a11y.html">Accessibility</a></li>
      <li><a href="/slow.html">Slow</a></li>
      <li><a href="/missing.html">Missing page</a></li>
    </ul>`),

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

/** Starts the fixture site on a random free port. */
export async function startFixtureSite(): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
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
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
