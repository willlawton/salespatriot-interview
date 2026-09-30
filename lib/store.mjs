// Build the in-memory dataset from the raw files in ./data.
// ~50k lines / ~45k solicitations fits comfortably in memory; queries scan an array in milliseconds.
import fs from 'node:fs';
import path from 'node:path';
import { parseIndex, parseCsv, unzip, fmtSol, fmtNsn } from './parse.mjs';
import { fscName, officeName } from './labels.mjs';

const fileDate = (name) => `20${name.slice(2, 4)}-${name.slice(4, 6)}-${name.slice(6, 8)}`;
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

export function build(dataDir) {
  const names = fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : [];
  const indexFiles = names.filter((f) => /^in\d{6}\.txt$/.test(f)).sort();
  const zipFiles = names.filter((f) => /^bq\d{6}\.zip$/.test(f)).sort();

  // 1. Lines, keyed by (solicitation, purchase request). Oldest file first, newest wins.
  //    Re-posts (amendments) usually extend the return-by date; keep the earlier date.
  const lines = new Map();
  let lineCount = 0;
  for (const f of indexFiles) {
    const posted = fileDate(f);
    for (const r of parseIndex(fs.readFileSync(path.join(dataDir, f)).toString('latin1'))) {
      lineCount++;
      const key = `${r.sol}|${r.pr}`;
      const prev = lines.get(key);
      r.firstPosted = prev ? prev.firstPosted : posted;
      r.lastPosted = posted;
      r.prevReturnBy = prev ? (prev.returnBy !== r.returnBy ? prev.returnBy : prev.prevReturnBy) : null;
      lines.set(key, r);
    }
  }

  // 2. Approved sources (as*.txt inside bq*.zip): NSN -> CAGE -> part numbers.
  const sources = new Map();
  for (const f of zipFiles) {
    try {
      const entries = unzip(fs.readFileSync(path.join(dataDir, f)));
      for (const [name, buf] of Object.entries(entries)) {
        if (!/^as/i.test(name)) continue;
        for (const [nsn, cage, part] of parseCsv(buf.toString('latin1'))) {
          if (!nsn || !cage) continue;
          if (!sources.has(nsn)) sources.set(nsn, new Map());
          const byCage = sources.get(nsn);
          if (!byCage.has(cage)) byCage.set(cage, new Set());
          if (part) byCage.get(cage).add(part);
        }
      }
    } catch (e) {
      console.warn(`Could not read ${f}: ${e.message}`);
    }
  }

  // 3. Roll lines up to one row per solicitation (95% have a single line).
  const bySol = new Map();
  for (const r of lines.values()) {
    if (!bySol.has(r.sol)) bySol.set(r.sol, []);
    bySol.get(r.sol).push(r);
  }
  const sols = [];
  for (const [sol, L] of bySol) {
    const f = L[0];
    const nsns = [...new Set(L.map((x) => x.nsn))];
    const src = new Map();
    for (const n of nsns) for (const [cage, parts] of sources.get(n) || []) {
      if (!src.has(cage)) src.set(cage, new Set());
      for (const p of parts) src.get(cage).add(p);
    }
    const fsc = f.itemType === '1' ? f.nsn.slice(0, 4) : '';
    const office = sol.slice(0, 5);
    const prevDates = L.map((x) => x.prevReturnBy).filter(Boolean).sort();
    const s = {
      sol,
      solDisplay: fmtSol(sol),
      nsn: f.nsn,
      nsnDisplay: f.itemType === '1' ? fmtNsn(f.nsn) : f.nsn,
      nsnCount: nsns.length,
      nom: f.nom,
      fsc,
      fscName: fscName(fsc),
      qty: L.reduce((a, x) => a + x.qty, 0),
      ui: f.ui,
      returnBy: L.map((x) => x.returnBy).sort().at(-1),
      prevReturnBy: prevDates[0] || null,
      extended: L.some((x) => x.prevReturnBy && x.prevReturnBy < x.returnBy),
      firstPosted: L.map((x) => x.firstPosted).sort()[0],
      lastPosted: L.map((x) => x.lastPosted).sort().at(-1),
      setAside: f.setAside,
      setAsidePct: f.setAsidePct,
      amsc: f.amsc,
      buyer: f.buyer,
      office,
      officeName: officeName(office),
      itemType: f.itemType,
      lineCount: L.length,
      lines: L.map((x) => ({ pr: x.pr, nsn: fmtNsn(x.nsn), qty: x.qty, ui: x.ui, returnBy: x.returnBy, firstPosted: x.firstPosted })),
      sources: [...src].map(([cage, parts]) => ({ cage, parts: [...parts] })),
    };
    // Search fields: identifiers with punctuation stripped, and lowercase words.
    s.idx = [sol, ...nsns, ...nsns.map((n) => n.slice(4)), ...L.map((x) => x.pr), ...s.sources.flatMap((x) => [x.cage, ...x.parts])]
      .map(norm).join(' ');
    s.text = `${s.nom} ${s.fscName} ${s.officeName}`.toLowerCase();
    sols.push(s);
  }

  const dates = indexFiles.map(fileDate);
  return {
    sols,
    meta: {
      files: indexFiles.length,
      earliestFile: dates[0] || null,
      latestFile: dates.at(-1) || null,
      lines: lineCount,
      uniqueLines: lines.size,
      solicitations: sols.length,
      withSources: sols.filter((s) => s.sources.length).length,
      builtAt: new Date().toISOString(),
    },
  };
}
