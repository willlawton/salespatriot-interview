// RFQ Radar — zero-dependency Node server.
//   node server.mjs            -> serves http://localhost:3000, syncs from DIBBS on start + hourly
//   OFFLINE=1 node server.mjs  -> serves whatever is already in ./data, never calls DIBBS
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sync } from './lib/ingest.mjs';
import { build } from './lib/store.mjs';
import { query, detail, sampleProfile, profileFrom } from './lib/query.mjs';
import { awardsFor, tableRead } from './lib/awards.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, 'data');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const OFFLINE = process.env.OFFLINE === '1';

let state = null;
const status = { phase: 'starting', message: 'Starting…', lastSync: null, error: null };

function rebuild() {
  const t = Date.now();
  const next = build(DATA);
  if (next.sols.length) state = next;
  console.log(`Loaded ${next.sols.length.toLocaleString()} solicitations from ${next.meta.files} daily files in ${Date.now() - t} ms`);
}

async function refresh() {
  if (OFFLINE || status.phase === 'syncing') return;
  status.phase = 'syncing';
  status.error = null;
  try {
    const r = await sync(DATA, (msg) => { status.message = msg; console.log(msg); });
    if (r.downloaded || !state) rebuild();
    status.lastSync = new Date().toISOString();
    status.message = r.failed.length ? `Synced with ${r.failed.length} file(s) skipped` : 'Up to date';
  } catch (e) {
    console.error(e);
    status.error = e.message;
    status.message = `Sync failed: ${e.message}`;
  } finally {
    status.phase = state ? 'ready' : 'error';
  }
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = Object.fromEntries(url.searchParams);
  try {
    if (url.pathname === '/api/status') return json(res, 200, { ...status, hasData: !!state, meta: state?.meta || null });
    if (url.pathname === '/api/solicitations') {
      if (!state) return json(res, 503, { ...status, hasData: false });
      const t = Date.now();
      const out = query(state, p);
      out.ms = Date.now() - t;
      return json(res, 200, out);
    }
    if (url.pathname === '/api/solicitation') {
      if (!state) return json(res, 503, status);
      const d = detail(state, p);
      return d ? json(res, 200, d) : json(res, 404, { error: 'Not found' });
    }
    if (url.pathname === '/api/tableread') {
      if (!state) return json(res, 503, status);
      const s = state.sols.find((x) => x.sol === p.sol);
      if (!s) return json(res, 404, { error: 'Not found' });
      const pr = profileFrom(p);
      const nsns = [...new Set(s.lines.map((l) => l.nsn.replace(/-/g, '')))].filter((n) => /^\d{13}$/.test(n));
      Promise.all(nsns.map((n) => awardsFor(n, DATA)))
        .then((hist) => {
          const awards = hist.flatMap((h) => h.awards).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
          const read = tableRead(awards, { qtyBySol: state.qtyBySol, approved: new Set(s.sources.map((x) => x.cage)), mine: pr.cages });
          json(res, 200, { ...read, qty: s.qty, ui: s.ui, truncated: hist.some((h) => h.truncated), source: 'DIBBS award search by NSN' });
        })
        .catch((e) => json(res, 502, { error: e.message }));
      return;
    }
    if (url.pathname === '/api/sample-profile') {
      if (!state) return json(res, 503, status);
      return json(res, 200, sampleProfile(state));
    }
    if (url.pathname === '/api/refresh' && req.method === 'POST') {
      refresh();
      return json(res, 202, status);
    }
    // Static files
    const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message });
  }
});

rebuild(); // serve cached data immediately if we have any
status.phase = state ? 'ready' : 'starting';
server.listen(PORT, () => {
  console.log(`RFQ Radar running at http://localhost:${PORT}${OFFLINE ? ' (offline)' : ''}`);
  refresh();
  if (!OFFLINE) setInterval(refresh, 60 * 60 * 1000);
});
