import zlib from 'node:zlib';

// in*.txt: fixed width, 140 chars/line, ISO-8859-1. Layout from DIBBS /Rfq/RfqFileDefs.aspx.
const mdy = (s) => `20${s.slice(6, 8)}-${s.slice(0, 2)}-${s.slice(3, 5)}`;
export function parseIndexLine(l) {
  return {
    sol: l.slice(0, 13).trim(),
    nsn: l.slice(13, 59).trim(),
    pr: l.slice(59, 72).trim(),
    returnBy: mdy(l.slice(72, 80)),
    qty: parseInt(l.slice(99, 106), 10) || 0,
    ui: l.slice(106, 108).trim(),
    nom: l.slice(108, 129).trim(),
    buyer: l.slice(129, 134).trim(),
    amsc: l.slice(134, 135).trim(),
    itemType: l.slice(135, 136), // 1 = NSN, 2 = part number
    setAside: l.slice(136, 137).trim() || 'N',
    setAsidePct: parseInt(l.slice(137, 140), 10) || 0,
  };
}
export function parseIndex(text) {
  const rows = [];
  for (const l of text.split(/\r?\n/)) {
    if (l.length < 137 || !/^\d\d\/\d\d\/\d\d$/.test(l.slice(72, 80))) continue;
    rows.push(parseIndexLine(l));
  }
  return rows;
}

// as*.txt / bq*.txt: comma separated, double-quoted.
export function parseCsv(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const f = [];
    let i = 0;
    while (i <= line.length) {
      if (line[i] === '"') {
        let j = i + 1, v = '';
        while (j < line.length) {
          if (line[j] === '"' && line[j + 1] === '"') { v += '"'; j += 2; }
          else if (line[j] === '"') break;
          else v += line[j++];
        }
        f.push(v);
        i = j + 2;
      } else {
        const j = line.indexOf(',', i);
        f.push(line.slice(i, j < 0 ? undefined : j));
        i = j < 0 ? line.length + 1 : j + 1;
      }
    }
    out.push(f);
  }
  return out;
}

// Minimal ZIP reader (stored + deflate), enough for the bq*.zip files. No dependencies.
export function unzip(buf) {
  let e = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('Not a zip file');
  const n = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const out = {};
  for (let k = 0; k < n; k++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('latin1', p + 46, p + 46 + nl);
    p += 46 + nl + el + cl;
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const data = buf.subarray(start, start + csize);
    out[name] = method === 8 ? zlib.inflateRawSync(data) : data;
  }
  return out;
}

export const fmtSol = (s) => (s.length === 13 ? `${s.slice(0, 6)}-${s.slice(6, 8)}-${s.slice(8, 9)}-${s.slice(9)}` : s);
export const fmtNsn = (n) => (/^\d{13}$/.test(n) ? `${n.slice(0, 4)}-${n.slice(4, 6)}-${n.slice(6, 9)}-${n.slice(9)}` : n);
