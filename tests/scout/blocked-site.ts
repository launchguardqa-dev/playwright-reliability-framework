import * as http from 'http';
import { AddressInfo } from 'net';
import { LoggedRequest } from './fixture-site';

/**
 * Sites protected by bot protection, modeled on what real WAFs/CDNs return.
 *
 * Every block page here has problems axe would flag (no lang attribute, and it's wider than
 * a phone), so any accessibility or mobile finding in a test means Scout analyzed the block
 * page as if it were the site.
 */

export type BlockKind =
  | 'akamai-403'        // what El Cajon returned: 403 "Access Denied" + "Reference #..."
  | 'cloudflare-503'    // Cloudflare's JavaScript challenge: 503 "Just a moment..."
  | 'auth-401'          // a whole site behind HTTP auth
  | 'rate-limit-429'    // too many requests
  | 'blocks-later'      // homepage is fine; the second page hits the WAF
  | 'spa-404';          // NOT a block: a single-page app that renders real content with a 404 status

const SPA_404 = `<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1"><title>Parks and Recreation</title></head><body>
  <main><h1>Parks and Recreation</h1><p>Find parks, pools and community centers, and register for summer camps and classes.</p>
  <img src="/pool.png" width="40" height="40"></main></body></html>`;

const BLOCK_PAGES: Record<Exclude<BlockKind, 'blocks-later' | 'spa-404'>,{ status: number; html: string; headers?: Record<string, string> }> = {
  'akamai-403': {
    status: 403,
    html: `<html><head><title>Access Denied</title></head><body>
      <h1>Access Denied</h1>
      <div style="width: 600px">You don't have permission to access "http&#58;&#47;&#47;www&#46;city&#46;gov&#47;" on this server.<p>
      Reference&#32;&#35;18&#46;6f0a1b2c&#46;1700000000&#46;abcdef12</div>
      <img src="/block-logo.png"></body></html>`,
  },
  'cloudflare-503': {
    status: 503,
    html: `<!DOCTYPE html><html><head><title>Just a moment...</title></head><body style="width: 640px">
      <h1>www.city.gov</h1><h2>Checking if the site connection is secure</h2>
      <p>Enable JavaScript and cookies to continue</p>
      <script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>`,
  },
  'auth-401': {
    status: 401,
    headers: { 'www-authenticate': 'Basic realm="staff"' },
    html: '<html><head><title>401 Unauthorized</title></head><body><div style="width: 600px">This server could not verify that you are authorized to access the document requested.</div></body></html>',
  },
  'rate-limit-429': {
    status: 429,
    headers: { 'retry-after': '60' },
    html: '<html><head><title>Slow down</title></head><body><div style="width: 600px">You are sending requests faster than we can handle. Please try again in a minute.</div></body></html>',
  },
};

// A normal page for the 'blocks-later' homepage, linking onward.
const HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1"><title>City Home</title></head><body>
  <header><nav aria-label="Main"><a href="/second">Second</a> <a href="/third">Third</a></nav></header>
  <main><h1>City Home</h1><p>Welcome. Council agendas, permits and utility billing are linked above.</p>
  <img src="/logo.png" width="40" height="40"></main></body></html>`;

export async function startBlockedSite(kind: BlockKind): Promise<{ origin: string; requests: LoggedRequest[]; close: () => Promise<void> }> {
  const requests: LoggedRequest[] = [];
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    requests.push({ method: req.method ?? 'GET', path, at: Date.now(), userAgent: String(req.headers['user-agent'] ?? ''), from: req.headers.from as string | undefined });
    if (path === '/robots.txt') {
      res.writeHead(404); // like El Cajon: "robots.txt: absent"
      res.end();
      return;
    }
    if (kind === 'spa-404') {
      // Every route is served with 404 and rendered client-side; the content is real.
      res.writeHead(path.endsWith('.png') ? 200 : 404, { 'content-type': path.endsWith('.png') ? 'image/png' : 'text/html' });
      res.end(path.endsWith('.png') ? Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') : SPA_404);
      return;
    }
    if (kind === 'blocks-later') {
      if (path === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(HOME);
        return;
      }
      if (path === '/logo.png') {
        res.writeHead(404);
        res.end();
        return;
      }
      const block = BLOCK_PAGES['akamai-403'];
      res.writeHead(block.status, { 'content-type': 'text/html' });
      res.end(block.html);
      return;
    }
    const block = BLOCK_PAGES[kind];
    res.writeHead(block.status, { 'content-type': 'text/html', ...block.headers });
    res.end(block.html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
