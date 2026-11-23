// Loads index.html in jsdom with fetch stubbed to serve test/fixtures/*.json.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach } from 'node:test';

const open = new Set();
afterEach(() => { for (const w of open) w.close(); open.clear(); });

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');
export const fixture = name => JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', name + '.json'), 'utf8'));

// Default routes: scoreboard + every summary fixture by event id. Override per test with `routes`.
export function defaultRoutes() {
  const r = { scoreboard: 'scoreboard' };
  for (const id of ['401910029', '401910030', '401910031', '401910032', '401910033', '401910034']) r['summary:' + id] = 'summary-' + id;
  return r;
}

const routeKey = url => {
  const u = new URL(url);
  const core = u.pathname.match(/\/events\/(\d+)\/competitions\/\d+\/(plays|status)$/);
  if (core) return 'core:' + core[2] + ':' + core[1];
  if (u.pathname.endsWith('/scoreboard')) return 'scoreboard' + (u.searchParams.get('dates') ? ':' + u.searchParams.get('dates') : '');
  if (u.pathname.endsWith('/summary')) return 'summary:' + u.searchParams.get('event');
  return url;
};

// serve one page of a full core-API play list, like the real endpoint (1-based `page`, `limit` per page)
function page(all, q) {
  const limit = +q.get('limit') || 25, p = +q.get('page') || 1, count = all.items.length;
  return { count, pageIndex: p, pageSize: limit, pageCount: Math.ceil(count / limit), items: all.items.slice((p - 1) * limit, p * limit) };
}

// Default hash opens the live OKC@MIA game (the page itself lands on home); pass hash: '' for home, '#v=game' for the games grid.
export async function boot({ hash = '#g=401910030', routes = defaultRoutes(), storage = {} } = {}) {
  const calls = [], delays = [];
  let closed = false;
  const dom = new JSDOM(HTML, {
    url: 'https://nsanders.me/nba-gameday/' + hash,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      const st = w.setTimeout.bind(w);
      w.setTimeout = (fn, ms, ...rest) => { delays.push({ fn: fn?.name, ms }); return st(fn, ms, ...rest); };
      for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, JSON.stringify(v));
      w.fetch = async (url, opts) => {
        if (closed) return new Promise(() => {});        // window closed: leave the request hanging
        const key = routeKey(String(url));
        calls.push({ key, opts });
        const name = routes[key];
        if (!name) return { ok: false, status: 404, json: async () => ({}) };
        let body = typeof name === 'string' ? fixture(name) : name;
        if (key.startsWith('core:plays:')) body = page(body, new URL(String(url)).searchParams);
        const text = JSON.stringify(body);
        return { ok: true, status: 200, headers: { get: h => (h.toLowerCase() === 'content-length' ? String(Math.round(text.length / 8)) : null) },
          text: () => (closed ? new Promise(() => {}) : Promise.resolve(text)) };
      };
    },
  });
  const w = dom.window;
  open.add(w);
  const close = w.close.bind(w);
  w.close = () => { closed = true; close(); };
  const app = {
    window: w, document: w.document, calls, delays, routes,
    $: s => w.document.querySelector(s),
    $$: s => [...w.document.querySelectorAll(s)],
    // top-level `const`/`function`s in the page script live in the global lexical scope; eval reaches them
    eval: code => w.eval(code),
    async settle(until = () => true, ms = 2000) {
      const end = Date.now() + ms;
      do { await new Promise(r => setTimeout(r, 5)); } while (!until() && Date.now() < end);
      if (!until()) throw new Error('settle(): condition not met within ' + ms + 'ms');
    },
    close: () => w.close(),
  };
  return app;
}
