// DIBBS HTTP client.
// Two hosts (www = app, dibbs2 = files), each behind its own DoD consent page.
// Unconsented requests return HTTP 200 + consent HTML, so we detect it by content,
// submit the ASP.NET form, keep cookies per host, and retry.
import https from 'node:https';
import http from 'node:http';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';
export const WWW = process.env.DIBBS_WWW || 'https://www.dibbs.bsm.dla.mil'; // env overrides are for tests
export const FILES = process.env.DIBBS_FILES || 'https://dibbs2.bsm.dla.mil';

const jars = new Map(); // host -> Map(cookieName -> value)
const jar = (u) => {
  const h = new URL(u).host;
  if (!jars.has(h)) jars.set(h, new Map());
  return jars.get(h);
};
const cookieHeader = (u) => [...jar(u)].map(([k, v]) => `${k}=${v}`).join('; ');
function keepCookies(u, res) {
  const sc = res.headers['set-cookie'];
  const list = Array.isArray(sc) ? sc : sc ? [sc] : [];
  for (const c of list) {
    const kv = c.split(';')[0];
    const i = kv.indexOf('=');
    if (i > 0) jar(u).set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
  }
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const isConsent = (html) => /butAgree|Notice and Consent Banner/i.test(html);

// Uses node:https rather than fetch(): the DIBBS F5 firewall rejects undici/fetch
// (it adds headers like `sec-fetch-mode` and `accept-language: *`), but accepts
// plain node:https with ordinary browser headers.
const DEBUG = !!process.env.DIBBS_DEBUG;
function request(url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request(u, { method, headers, timeout: 60_000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function raw(url, opts = {}, hops = 0) {
  const headers = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    ...(jar(url).size ? { Cookie: cookieHeader(url) } : {}),
    ...(opts.headers || {}),
  };
  if (opts.body) headers['Content-Length'] = Buffer.byteLength(opts.body);
  let res;
  try {
    res = await request(url, { method: opts.method, body: opts.body, headers });
  } catch (e) {
    throw new Error(`Could not reach ${new URL(url).host} (${e.code || e.message})`);
  }
  if (DEBUG) console.log(`[dibbs] ${opts.method || 'GET'} ${url} -> ${res.status} ${res.headers['content-type'] || ''} ${res.buf.length}b`);
  keepCookies(url, res);
  const loc = res.headers.location;
  if (res.status >= 300 && res.status < 400 && loc) {
    if (hops > 6) throw new Error(`Too many redirects at ${url}`);
    return raw(new URL(loc, url).href, { headers: { Referer: url } }, hops + 1);
  }
  return { url, res, buf: res.buf };
}

async function acceptConsent(pageUrl, html) {
  const action = (html.match(/<form[^>]*action="([^"]*)"/i) || [])[1];
  if (!action) throw new Error('DIBBS consent form not found');
  const body = new URLSearchParams();
  for (const [tag] of html.matchAll(/<input[^>]*>/gi)) {
    const attr = (n) => (tag.match(new RegExp(`${n}="([^"]*)"`, 'i')) || [])[1];
    if ((attr('type') || '').toLowerCase() === 'hidden' && attr('name')) body.set(attr('name'), decode(attr('value') || ''));
  }
  body.set('butAgree', 'OK');
  await raw(new URL(decode(action), pageUrl).href, {
    method: 'POST',
    body: body.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: new URL(pageUrl).origin, Referer: pageUrl },
  });
}

/** GET a DIBBS URL, handling consent. Returns { status, contentType, buf }. */
export async function get(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await raw(url);
    const ct = r.res.headers['content-type'] || '';
    if (r.res.status === 404) return { status: 404 };
    if (/text\/html/i.test(ct)) {
      const html = r.buf.toString('latin1');
      if (isConsent(html)) { await acceptConsent(r.url, html); continue; }
      if (/Request Rejected/i.test(html)) {
        const id = (html.match(/support ID is:?\s*([\d]+)/i) || [])[1];
        throw new Error(`Blocked by the DIBBS firewall ("Request Rejected") at ${r.url}${id ? ` (support ID ${id})` : ''}. Re-run with DIBBS_DEBUG=1 to see every request.`);
      }
    }
    return { status: r.res.status, contentType: ct, buf: r.buf };
  }
  throw new Error(`Could not get past the DIBBS consent page for ${url}`);
}

/** Dates (YYMMDD) of the daily files currently listed on the Recent RFQs page. */
export async function listRecentDates() {
  const r = await get(`${WWW}/RFQ/RfqDates.aspx?category=recent`);
  if (r.status !== 200) throw new Error(`Recent RFQs page returned HTTP ${r.status}`);
  const html = r.buf.toString('latin1');
  return [...new Set([...html.matchAll(/in(\d{6})\.txt/gi)].map((m) => m[1]))].sort();
}

export const fileUrl = (name) => `${FILES}/Downloads/RFQ/Archive/${name}`;
export const links = (sol) => ({
  record: `${WWW}/rfq/rfqrec.aspx?sn=${sol}`,
  quote: `${WWW}/RA/Quote/QuoteFrm.aspx?sn=${sol}`,
  pdf: `${FILES}/Downloads/RFQ/${sol.slice(-1)}/${sol}.PDF`,
});
