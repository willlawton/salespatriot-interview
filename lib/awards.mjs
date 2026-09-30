// Past awards per NSN from DIBBS (Awards > search by NSN). This is gate 4's evidence:
// who has been winning this part, how often, and at what price.
//
// Verified on live DIBBS (2026-09-30): a plain GET by URL, no postback paging for the
// first 50 rows; history covers roughly the last 4 months. The grid has stable span IDs.
// "Total Contract Price" is per award and repeats on each purchase-request row, so rows are
// de-duplicated by award + delivery order.
import fs from 'node:fs';
import path from 'node:path';
import { get, WWW } from './dibbs.mjs';

const TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_V = 2; // bump when the cached shape changes
const strip = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const iso = (mdY) => (/^\d\d-\d\d-\d{4}$/.test(mdY) ? `${mdY.slice(6)}-${mdY.slice(0, 2)}-${mdY.slice(3, 5)}` : null);

export function parseAwards(html) {
  const found = parseInt((strip(html).match(/Records Found:\s*(\d+)/i) || [])[1] || '0', 10);
  const rows = new Map(); // ctlNN -> fields
  for (const m of html.matchAll(/grdAwardSearch_(ctl\d+)_lbl(\w+)"[^>]*>([\s\S]*?)<\/span>/g)) {
    const [, row, field, inner] = m;
    if (!rows.has(row)) rows.set(row, {});
    rows.get(row)[field] = strip(inner);
  }
  const byKey = new Map();
  for (const r of rows.values()) {
    const award = (r.AwardBasicNumber || '').split(' ')[0];
    const order = (r.DeliveryOrder || '').split(' ')[0];
    if (!award) continue;
    const key = `${award}|${order}`;
    const pr = r.PurchaseRequest || '';
    if (byKey.has(key)) { if (pr) byKey.get(key).prs.push(pr); continue; }
    const total = parseFloat((r.TotalContactPrice || '').replace(/[$,]/g, ''));
    byKey.set(key, {
      award, order,
      cage: r.Cage || '',
      total: total > 0 ? total : null, // DIBBS shows $0.00 when the price isn't published
      date: iso(r.AwardDate || ''),
      nsn: r.Nsn || '',
      sol: r.Solicitation || '',
      prs: pr ? [pr] : [],
    });
  }
  const awards = [...byKey.values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { found, awards, truncated: found > rows.size };
}

// Quantity per purchase request from a (closed) RFQ record page: "7017805294 <br>Qty: 6".
// The daily RFQ files only cover ~1 month, but DIBBS keeps the record pages of older RFQs.
export function parseRfqQty(html) {
  const out = {};
  for (const m of html.matchAll(/(\d{10,13})\s*<br\s*\/?>\s*Qty:\s*([\d,]+)/gi)) out[m[1]] = parseInt(m[2].replace(/,/g, ''), 10);
  return out;
}

export async function qtyForSol(sol, dataDir) {
  const dir = path.join(dataDir, 'rfq-qty');
  const file = path.join(dir, `${sol.replace(/[^A-Za-z0-9]/g, '')}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); // closed RFQs don't change
  const r = await get(`${WWW}/rfq/rfqrec.aspx?sn=${encodeURIComponent(sol)}`);
  if (r.status !== 200) return {};
  const byPr = parseRfqQty(r.buf.toString('latin1'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(byPr));
  return byPr;
}

// Attach a quantity to each award: from our daily files if we hold the RFQ, otherwise from the
// RFQ record page (one request per solicitation, cached forever). Most recent awards first, capped.
export async function withQuantities(awards, { qtyBySol, dataDir, limit = 10 }) {
  const out = [];
  for (const [i, a] of awards.entries()) {
    let qty = qtyBySol.get(a.sol) || null;
    if (!qty && a.sol && i < limit) {
      try {
        const byPr = await qtyForSol(a.sol, dataDir);
        const prQty = (a.prs || []).map((p) => byPr[p]).filter(Boolean);
        qty = prQty.length ? prQty.reduce((x, y) => x + y, 0) : Object.values(byPr).reduce((x, y) => x + y, 0) || null;
      } catch { /* leave unknown */ }
    }
    out.push({ ...a, qty });
  }
  return out;
}

export async function awardsFor(nsn, dataDir) {
  const dir = path.join(dataDir, 'awards');
  const file = path.join(dir, `${nsn.replace(/[^A-Za-z0-9]/g, '')}.json`);
  if (fs.existsSync(file)) {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (cached.v === CACHE_V && Date.now() - cached.fetchedAt < TTL_MS) return cached;
  }
  const r = await get(`${WWW}/Awards/AwdRecs.aspx?Category=nsn&TypeSrch=cq&Value=${encodeURIComponent(nsn)}`);
  if (r.status !== 200) throw new Error(`Award search returned HTTP ${r.status}`);
  const out = { v: CACHE_V, nsn, fetchedAt: Date.now(), ...parseAwards(r.buf.toString('latin1')) };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  return out;
}

// Turn award history into a read on "who's at the table".
// qtyBySol lets us convert award totals to unit prices when we hold that solicitation's RFQ file.
export function tableRead(awards, { qtyBySol, approved, mine }) {
  const n = awards.length;
  const byCage = {};
  for (const a of awards) byCage[a.cage] = (byCage[a.cage] || 0) + 1;
  const winners = Object.entries(byCage).sort((a, b) => b[1] - a[1]).map(([cage, wins]) => ({
    cage, wins, approved: approved.has(cage), mine: mine.has(cage),
  }));
  const top = winners[0];
  const unit = awards
    .map((a) => ({ ...a, qty: a.qty ?? qtyBySol.get(a.sol) ?? null }))
    .map((a) => ({ ...a, unitPrice: a.qty && a.total ? a.total / a.qty : null }));
  const unitPrices = unit.map((a) => a.unitPrice).filter((x) => x != null).sort((a, b) => a - b);
  const median = unitPrices.length ? unitPrices[Math.floor(unitPrices.length / 2)] : null;
  const dates = awards.map((a) => a.date).filter(Boolean).sort();
  const spanDays = dates.length > 1 ? (Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 864e5 : 0;

  let heat, headline;
  if (!n) {
    heat = 'unknown';
    headline = 'No awards for this NSN in DIBBS’s recent history (~4 months). New or infrequent buy, so the table is unknown.';
  } else if (winners.length === 1 && n >= 2) {
    heat = 'incumbent';
    headline = `One winner: CAGE ${top.cage} won all ${n} recent awards. A sticky incumbent: hard to dislodge on price, but a thin table if they slip.`;
  } else if (winners.length >= 4 || top.wins / n < 0.5) {
    heat = 'crowded';
    headline = `${n} recent awards split among ${winners.length} different winners. Expect a price fight.`;
  } else if (n === 1) {
    heat = 'thin';
    headline = `Only one recent award (CAGE ${top.cage}). Little history, so probably a thin table.`;
  } else {
    heat = 'contested';
    headline = `${n} recent awards, ${winners.length} winners. CAGE ${top.cage} leads with ${top.wins}.`;
  }

  return {
    n, heat, headline, winners,
    lastAward: unit[0] || null,
    awards: unit.slice(0, 15),
    anchorUnitPrice: median, unitPriceCount: unitPrices.length,
    perMonth: spanDays > 20 ? +(n / (spanDays / 30)).toFixed(1) : null,
    // Naive baseline for a sealed low-price auction: one of (recent winners + you).
    // Deliberately simple and labeled as such in the UI; calibrate with real outcomes.
    baselineWinChance: n ? 1 / (winners.length + 1) : null,
  };
}
