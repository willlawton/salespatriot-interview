// Search + filter + facet counts over the in-memory solicitations.
//
// The core idea is three bid/no-bid gates, applied in order:
//   Gate 1  Can I still bid?     deadline hasn't passed                    (RFQ data only)
//   Gate 2  Am I allowed to?     set-aside matches my certifications       (RFQ + my profile)
//   Gate 3  Can I get the part?  one of my suppliers is an approved source,
//                                or it's in a product class I deal in      (RFQ + approved sources + my profile)
//
// Every count is computed with all the *other* active filters applied, so each
// option tells you how many results you'd get if you clicked it.
import { links } from './dibbs.mjs';
import { SET_ASIDE, fscName, officeName } from './labels.mjs';

const DAY = 864e5;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const list = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);
export const QTY = [['1-10', 1, 10], ['11-100', 11, 100], ['101-1000', 101, 1000], ['1000+', 1001, Infinity]];

// Which set-aside codes each certification lets you bid on (codes from the DIBBS file spec).
// Every certification here implies small-business status. Anyone can bid unrestricted (N).
const CERT_CODES = {
  sb: ['Y'], wosb: ['Y', 'L'], edwosb: ['Y', 'L', 'E'], sdvosb: ['Y', 'R'], hubzone: ['Y', 'H'], '8a': ['Y', 'A'],
};

export function profileFrom(p) {
  const certs = list(p.certs);
  return {
    set: p.profile === '1',
    certs,
    cages: new Set(list(p.cages).map((c) => c.toUpperCase())),
    cats: new Set(list(p.cats)),
    eligible: new Set(['N', ...certs.flatMap((c) => CERT_CODES[c] || [])]),
  };
}

// Search: commas/semicolons/newlines separate alternatives (any may match).
// Within an alternative every word must match. A pasted run of identifiers
// ("8415016779240 5305012345678") is treated as a list, not an AND.
function matcher(q) {
  const isId = (t) => /\d/.test(t) && norm(t).length >= 5;
  const alts = [];
  for (const a of String(q || '').split(/[,;\n]+/)) {
    const toks = a.trim().split(/\s+/).filter(Boolean).map((t) => t.replace(/\*/g, ''));
    if (!toks.length) continue;
    if (toks.length > 1 && toks.every(isId)) toks.forEach((t) => alts.push([t]));
    else alts.push(toks);
  }
  if (!alts.length) return null;
  const compiled = alts.map((toks) => toks.map((t) => ({ id: norm(t), word: t.toLowerCase() })));
  return (s) => compiled.some((toks) => toks.every((t) => (t.id && s.idx.includes(t.id)) || s.text.includes(t.word)));
}

export function gatesFor(s, pr, today) {
  const open = s.returnBy >= today;
  const eligible = pr.eligible.has(s.setAside);
  const supplierMatch = s.sources.filter((x) => pr.cages.has(x.cage)).map((x) => x.cage);
  const categoryMatch = !!s.fsc && pr.cats.has(s.fsc);
  return { open, eligible, supplierMatch, categoryMatch, canSource: supplierMatch.length > 0 || categoryMatch };
}

export function query(state, p) {
  const today = localToday();
  const soon = addDays(today, 3);
  const latest = state.meta.latestFile;
  const d3 = latest && addDays(latest, -2), d7 = latest && addDays(latest, -6);
  const pr = profileFrom(p);
  const gate = Math.max(0, Math.min(3, p.gate != null && p.gate !== '' ? parseInt(p.gate, 10) || 0 : pr.set ? 3 : 1));
  const effGate = pr.set ? gate : Math.min(gate, 1); // gates 2-3 need a profile
  const m = matcher(p.q);
  const sa = new Set(list(p.sa)), fsc = new Set(list(p.fsc)), office = new Set(list(p.office));
  const qty = list(p.qty).map((k) => QTY.find((b) => b[0] === k)).filter(Boolean);
  const postedFrom = p.posted === 'latest' ? latest : p.posted === '3' ? d3 : p.posted === '7' ? d7 : null;

  const G = new Map(); // per-row gate results, computed once
  const g = (s) => { let r = G.get(s); if (!r) { r = gatesFor(s, pr, today); G.set(s, r); } return r; };

  const groups = {
    q: (s) => !m || m(s),
    gate: (s) => {
      if (effGate === 0) return true;
      const r = g(s);
      return r.open && (effGate < 2 || r.eligible) && (effGate < 3 || r.canSource);
    },
    closing: (s) => p.closing !== '1' || (s.returnBy >= today && s.returnBy <= soon),
    posted: (s) => !postedFrom || s.firstPosted >= postedFrom,
    extended: (s) => p.extended !== '1' || s.extended,
    sa: (s) => !sa.size || sa.has(s.setAside),
    fsc: (s) => !fsc.size || fsc.has(s.fsc),
    office: (s) => !office.size || office.has(s.office),
    qty: (s) => !qty.length || qty.some(([, lo, hi]) => s.qty >= lo && s.qty <= hi),
  };
  const names = Object.keys(groups);
  const fns = Object.values(groups);

  const f = {
    funnel: [0, 0, 0, 0], closing: 0, extended: 0,
    posted: { any: 0, latest: 0, 3: 0, 7: 0 }, sa: {}, fsc: {}, office: {}, qty: {},
  };
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const rows = [];
  for (const s of state.sols) {
    let fails = 0, failed = '';
    for (let i = 0; i < fns.length; i++) if (!fns[i](s)) { failed = names[i]; if (++fails > 1) break; }
    if (fails > 1) continue;
    const ok = (name) => fails === 0 || failed === name;
    if (fails === 0) rows.push(s);
    if (ok('gate')) {
      const r = g(s);
      f.funnel[0]++;
      if (r.open) {
        f.funnel[1]++;
        if (r.eligible) { f.funnel[2]++; if (r.canSource) f.funnel[3]++; }
      }
    }
    if (ok('closing') && s.returnBy >= today && s.returnBy <= soon) f.closing++;
    if (ok('extended') && s.extended) f.extended++;
    if (ok('posted')) {
      f.posted.any++;
      if (s.firstPosted === latest) f.posted.latest++;
      if (s.firstPosted >= d3) f.posted[3]++;
      if (s.firstPosted >= d7) f.posted[7]++;
    }
    if (ok('sa')) bump(f.sa, s.setAside);
    if (ok('fsc') && s.fsc) bump(f.fsc, s.fsc);
    if (ok('office')) bump(f.office, s.office);
    if (ok('qty')) { const b = QTY.find(([, lo, hi]) => s.qty >= lo && s.qty <= hi); if (b) bump(f.qty, b[0]); }
  }
  if (!pr.set) { f.funnel[2] = null; f.funnel[3] = null; }

  const sorts = {
    new: (a, b) => b.firstPosted.localeCompare(a.firstPosted) || a.returnBy.localeCompare(b.returnBy),
    closing: (a, b) => a.returnBy.localeCompare(b.returnBy) || b.firstPosted.localeCompare(a.firstPosted),
    qty: (a, b) => b.qty - a.qty,
  };
  rows.sort(sorts[p.sort] || sorts.new);

  const size = 50;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(pages, Math.max(1, parseInt(p.page, 10) || 1));
  const fscList = Object.entries(f.fsc).sort((a, b) => b[1] - a[1]);
  const topFsc = fscList.slice(0, 60);
  for (const code of fsc) if (!topFsc.some(([c]) => c === code)) topFsc.push([code, f.fsc[code] || 0]);

  return {
    today, gate: effGate, profileSet: pr.set, total: rows.length, page, pages,
    rows: rows.slice((page - 1) * size, page * size).map((s) => {
      const r = g(s);
      return {
        sol: s.sol, solDisplay: s.solDisplay, nsnDisplay: s.nsnDisplay, nsnCount: s.nsnCount, nom: s.nom,
        fsc: s.fsc, fscName: s.fscName, qty: s.qty, ui: s.ui, setAside: s.setAside, returnBy: s.returnBy,
        prevReturnBy: s.prevReturnBy, extended: s.extended, firstPosted: s.firstPosted, lineCount: s.lineCount,
        office: s.office, sourceCount: s.sources.length, cages: s.sources.slice(0, 2).map((x) => x.cage),
        eligible: r.eligible, supplierMatch: r.supplierMatch, categoryMatch: r.categoryMatch,
        link: links(s.sol).record,
      };
    }),
    facets: {
      funnel: f.funnel, closing: f.closing, extended: f.extended, posted: f.posted, qty: f.qty,
      sa: Object.entries(SET_ASIDE).map(([k, label]) => [k, f.sa[k] || 0, label]),
      fsc: topFsc.map(([code, n]) => [code, n, fscName(code)]),
      fscTotal: fscList.length,
      office: Object.entries(f.office).sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, n, officeName(k)]),
    },
    meta: state.meta,
  };
}

export function detail(state, p) {
  const s = state.sols.find((x) => x.sol === p.sol);
  if (!s) return null;
  const { idx, text, ...rest } = s;
  const pr = profileFrom(p);
  const today = localToday();
  return {
    ...rest, today, profileSet: pr.set, gates: gatesFor(s, pr, today),
    setAsideLabel: SET_ASIDE[s.setAside] || s.setAside, links: links(s.sol),
  };
}

// A realistic demo profile drawn from the live data: the approved-source CAGEs and
// product classes that appear most often among open RFQs.
export function sampleProfile(state) {
  const today = localToday();
  const cages = {}, fscs = {};
  for (const s of state.sols) {
    if (s.returnBy < today) continue;
    for (const x of s.sources) cages[x.cage] = (cages[x.cage] || 0) + 1;
    if (s.fsc) fscs[s.fsc] = (fscs[s.fsc] || 0) + 1;
  }
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
  return { certs: ['sb'], cages: top(cages, 6), cats: top(fscs, 4) };
}
