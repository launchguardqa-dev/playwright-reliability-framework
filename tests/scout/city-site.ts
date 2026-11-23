import * as http from 'http';
import { AddressInfo } from 'net';
import { LoggedRequest } from './fixture-site';

/**
 * A miniature government site modeled on a real first run (Granicus GovAccess/OpenCities):
 *
 * - The homepage is reachable as "/", "/Home" and "/Home?oc_lang=en-US", and declares
 *   <link rel="canonical" href="/Home">. "/home-copy" serves identical content with
 *   no canonical, so only its content gives it away.
 * - The header nav links to the duplicates first, then to real sections.
 * - An embedded video player comes from a DIFFERENT host (localhost vs 127.0.0.1), so it's
 *   third-party: it has an unnamed button, logs a console error and makes a failing request.
 *   A second, untitled player iframe is also embedded.
 * - The site's own content has one real problem: a logo image with no alt text.
 */

const page = (title: string, body: string, opts: { canonical?: string } = {}) =>
  '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width, initial-scale=1">'
  + `<title>${title}</title>${opts.canonical ? `<link rel="canonical" href="${opts.canonical}">` : ''}</head><body>`
  + `<header><nav aria-label="Main">
       <a href="/Home">Home</a> <a href="/Home?oc_lang=en-US">English</a>
       <a href="/departments">Departments</a> <a href="/services">Services</a> <a href="/contact">Contact</a>
     </nav></header>`
  + `<main><h1>${title}</h1>${body}</main>`
  + '<footer><a href="/home-copy">Print version</a></footer></body></html>';

const HOME_BODY = (embedOrigin: string) => `
  <img src="/img/seal.png" width="40" height="40">
  <p>Welcome to the City of Example. Find council agendas and minutes, pay a utility bill,
  report a pothole, apply for permits, and read the latest news from city departments.
  Council meets the first and third Tuesday of each month at 6 p.m. in council chambers,
  and every meeting is streamed live and archived below for residents who cannot attend.</p>
  <iframe title="City Council meeting video" src="${embedOrigin}/player" width="320" height="180"></iframe>
  <iframe src="${embedOrigin}/player?autoplay=0" width="320" height="180"></iframe>`;

const EMBED_PLAYER = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Player</title></head><body>
  <button class="play-icon"><svg width="16" height="16" aria-hidden="true"></svg></button>
  <script>
    console.error('Player telemetry failed to initialize');
    fetch('/stats?t=' + Date.now());
  </script>
</body></html>`;

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

export async function startCitySite(): Promise<{
  origin: string;
  embedOrigin: string;
  requests: LoggedRequest[];
  close: () => Promise<void>;
}> {
  const requests: LoggedRequest[] = [];

  const embed = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/player') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(EMBED_PLAYER);
    } else {
      res.writeHead(500);
      res.end();
    }
  });
  // Same machine, different host name: "localhost" is a third party to "127.0.0.1".
  const embedOrigin = `http://localhost:${await listen(embed)}`;

  const pages: Record<string, string> = {
    '/': page('City of Example', HOME_BODY(embedOrigin), { canonical: '/Home' }),
    '/Home': page('City of Example', HOME_BODY(embedOrigin), { canonical: '/Home' }),
    '/home-copy': page('City of Example', HOME_BODY(embedOrigin)),
    '/departments': page('Departments', '<p>Public Works, Utilities, Planning, Parks and Recreation, City Clerk.</p>'),
    '/services': page('Services', '<p>Pay a bill, report an issue, apply for a permit, find a park.</p>'),
    '/contact': page('Contact', '<p>City Hall, 1 Civic Center Drive. Open weekdays 8 a.m. to 5 p.m.</p>'),
  };

  const site = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    requests.push({
      method: req.method ?? 'GET', path, at: Date.now(),
      userAgent: String(req.headers['user-agent'] ?? ''), from: req.headers.from as string | undefined,
    });
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('User-agent: *\nDisallow:\n');
    } else if (path === '/img/seal.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG);
    } else if (pages[path]) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(pages[path]);
    } else {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<!doctype html><html lang="en"><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1></body></html>');
    }
  });
  const origin = `http://127.0.0.1:${await listen(site)}`;

  return {
    origin,
    embedOrigin,
    requests,
    close: async () => {
      await new Promise<void>((resolve) => site.close(() => resolve()));
      await new Promise<void>((resolve) => embed.close(() => resolve()));
    },
  };
}
