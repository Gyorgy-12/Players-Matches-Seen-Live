import fs from 'node:fs';
import path from 'node:path';
import { AS_OF } from './source-cache.mjs';
import { archivedSource } from './archived-source.mjs';

const directory = path.join(import.meta.dirname, 'sources');
const snapshots = fs.readdirSync(directory)
  .filter(name => /^(?:market|all-player)-history-\d{4}-\d{2}-\d{2}\.json$/.test(name))
  .map(name => ({ name, date: name.match(/\d{4}-\d{2}-\d{2}/)[0] }))
  .filter(item => item.date <= AS_OF)
  .sort((a, b) => b.date.localeCompare(a.date))
  .map(item => ({ ...item, players: JSON.parse(fs.readFileSync(path.join(directory, item.name), 'utf8')).players }));

// Historical points do not become current data just because an export is rebuilt.
// Reuse their original provenance only after checking the career maximum against
// the newly fetched profile. A changed maximum requires a newly verified graph.
export function verifiedMarketHistory(id, profile) {
  let result;
  for (const snapshot of snapshots) {
    if (!Object.hasOwn(snapshot.players, id)) continue;
    result = {
      date: snapshot.date,
      graph: snapshot.players[id].map(([x, y, datum_mw, verein]) => ({ x, y, datum_mw, verein })),
      source: `tools/sources/${snapshot.name}`,
    };
    break;
  }
  if (!result) {
    const url = `https://www.transfermarkt.com/ceapi/marketValueDevelopment/graph/${id}`;
    const cached = archivedSource(url, true, AS_OF);
    if (Array.isArray(cached?.data?.list)) result = { date: cached.date, graph: cached.data.list, source: url };
  }
  if (!result) throw new Error(`Hiányzó értéktörténet: ${id}`);
  const peak = Math.max(0, ...result.graph.map(point => Number(point.y) || 0));
  if (peak !== Number(profile?.marketValueDetails?.highest?.value || 0)) {
    throw new Error(`Újra ellenőrizendő csúcsérték: ${id} (${peak} → ${profile?.marketValueDetails?.highest?.value})`);
  }
  return result;
}
