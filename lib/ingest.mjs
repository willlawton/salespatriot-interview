// Download any daily files we don't have yet into ./data (raw, as published).
// Files never change once posted, so the cache is append-only and re-runs are cheap.
import fs from 'node:fs';
import path from 'node:path';
import { get, listRecentDates, fileUrl } from './dibbs.mjs';

const looksLikeIndex = (buf) => {
  const first = buf.toString('latin1', 0, 200).split(/\r?\n/)[0];
  return first.length === 140;
};
const looksLikeZip = (buf) => buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;

export async function sync(dataDir, log = () => {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  log('Checking DIBBS for new daily files…');
  const dates = await listRecentDates();
  const todo = [];
  for (const d of dates) for (const name of [`in${d}.txt`, `bq${d}.zip`]) {
    if (!fs.existsSync(path.join(dataDir, name))) todo.push(name);
  }
  if (!todo.length) { log(`Up to date (${dates.length} daily files on DIBBS)`); return { dates, downloaded: 0, failed: [] }; }

  let done = 0;
  const failed = [];
  const fetchOne = async (name) => {
    try {
      const r = await get(fileUrl(name));
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
      if (name.endsWith('.txt') && !looksLikeIndex(r.buf)) throw new Error('unexpected content');
      if (name.endsWith('.zip') && !looksLikeZip(r.buf)) throw new Error('not a zip');
      fs.writeFileSync(path.join(dataDir, name), r.buf);
      done++;
      log(`Downloaded ${done}/${todo.length}: ${name}`);
    } catch (e) {
      failed.push(`${name}: ${e.message}`);
      log(`Skipped ${name}: ${e.message}`);
    }
  };

  // First file alone (passes the consent pages once), then 4 at a time.
  await fetchOne(todo[0]);
  const queue = todo.slice(1);
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) await fetchOne(queue.shift());
  }));
  return { dates, downloaded: done, failed };
}
