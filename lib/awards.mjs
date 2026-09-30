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
const strip = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const iso = (mdY) => (/^\d\d-\d\d-\d{4}$/.test(mdY) ? `${mdY.slice(6)}-${mdY.slice(0, 2)}-${mdY.slice(3, 5)}` : null);

export function parseAwards(html) {
  const found = parseInt((html.match(/Records Found:\s*(\d+)/i) || [])[1] || '0', 10);
  const rows = new Map(); // ctlNN -> fields
  for (const m of html.matchAll(/grdAwardSearch_(ctl\d+)_lbl(\w+)"[^>]*>([\s\S]*?)<\/span>/g)) {
    const [, row, field, inner] = m;
    if (!rows.has(row)) rows.set(row, {});
    rows.get(row)[field] = strip(inner);
  }
  const seen = new Set();
  const awards = [];
  for (const r of rows.values()) {
    const award = (r.AwardBasicNumber || '').split(' ')[0];
    const order = (r.DeliveryOrder || '').split(' ')[0];
    if (!award) continue;
    const key = `${award}|${order}`;
    if (seen.has(key)) continue;
    seen.add(key);
    awards.push({
      award, order,
      cage: r.Cage || '',
      total: parseFloat((r.TotalContactPrice || '').replace(/[$,]/g, '')) || 0,
      date: iso(r.AwardDate || ''),
      nsn: r.Nsn || '',
      sol: r.Solicitation || '',
    });
  }
  awards.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { found, awards, truncated: found > rows.size };
}

export async function awardsFor(nsn, dataDir) {
  const dir = path.join(dataDir, 'awards');
  const file = path.join(dir, `${nsn.replace(/[^A-Za-z0-9]/g, '')}.json`);
  if (fs.existsSync(file)) {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - cached.fetchedAt < TTL_MS) return cached;
  }
  const r = await get(`${WWW}/Awards/AwdRecs.aspx?Category=nsn&TypeSrch=cq&Value=${encodeURIComponent(nsn)}`);
  if (r.status !== 200) throw new Error(`Award search returned HTTP ${r.status}`);
  const out = { nsn, fetchedAt: Date.now(), ...parseAwards(r.buf.toString('latin1')) };
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
    .map((a) => ({ ...a, qty: qtyBySol.get(a.sol) || null }))
    .map((a) => ({ ...a, unitPrice: a.qty ? a.total / a.qty : null }));
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
