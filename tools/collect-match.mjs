import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { AS_OF, source } from './source-cache.mjs';
import { config } from './match-config.mjs';
import { archivedSource } from './archived-source.mjs';

export const GAME = config.gameId;
export const DATE = config.date;
const teams = [config.home, config.away];
const teamIds = teams.map(t => t.id);
export const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
export function elements(html, tag) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  const out = []; let depth = 0; let start = 0;
  for (const m of html.matchAll(re)) {
    if (!m[1]) { if (!depth) start = m.index; depth++; }
    else if (depth && !--depth) out.push(html.slice(start, m.index + m[0].length));
  }
  return out;
}
const money = text => {
  const m = strip(text).match(/€\s*([\d.,]+)\s*(m|k|bn)?/i);
  return m ? Math.round(Number(m[1].replace(/,/g, '')) * ({ m: 1e6, k: 1e3, bn: 1e9 }[m[2]] || 1)) : null;
};
const leagueNames = { GB1: 'Premier League', ES1: 'LaLiga', IT1: 'Serie A', L1: 'Bundesliga', FR1: 'Ligue 1' };
const lineupUrl = `https://www.transfermarkt.com/-/aufstellung/spielbericht/${GAME}`;
const snapshotFile = path.join(import.meta.dirname, 'sources', `match-${GAME}.json`);
const snapshot = fs.existsSync(snapshotFile) ? JSON.parse(fs.readFileSync(snapshotFile, 'utf8')) : null;
const sheetUrl = snapshot?.sheetUrl || (GAME === '4914525' ? 'https://www.transfermarkt.com/universitatea-cluj_rapid-bukarest/index/spielbericht/4914525' : `https://www.transfermarkt.com/spielbericht/index/spielbericht/${GAME}`);
const cutoffUrl = 'https://www.transfermarkt.com/x/marktwerteverein/wettbewerb/RO1/stichtag/2026-10-01/plus/1';
const [lineup, sheet, cutoff] = snapshot ? ['', '', ''] : await Promise.all([source(lineupUrl, false), source(sheetUrl, false, 4, { refresh: true }), source(cutoffUrl, false)]);
if (snapshot) {
  assert.equal(snapshot.gameId, GAME);
  assert.equal(snapshot.date, DATE);
  assert.equal(snapshot.score, config.score);
  assert.equal(snapshot.cutoff, '2026-10-01');
} else {
  assert.ok(strip(sheet).includes(DATE.split('-').reverse().join('/')));
  assert.ok(strip(sheet).includes(config.score));
}
const headers = [...lineup.matchAll(/<h2\b[^>]*>[\s\S]*?<\/h2>/g)];
const roster = snapshot ? snapshot.groups.flatMap(group => group.players.map(([id, nationality]) => ({
  id, nationality, clubId: group.clubId, club: teams.find(t => t.id === group.clubId).name, starter: group.starter,
}))) : [];
for (let i = 0; i < headers.length; i++) {
  const heading = headers[i][0];
  if (!/Starting Line-up|Substitutes/.test(heading)) continue;
  const clubId = heading.match(/\/verein\/(\d+)/)?.[1];
  assert.ok(teamIds.includes(clubId));
  const chunk = lineup.slice(headers[i].index + heading.length, headers[i + 1]?.index || lineup.length);
  const table = elements(chunk, 'table')[0];
  for (const row of elements(table, 'tr')) {
    const link = row.match(/href="(\/[^"/]+\/profil\/spieler\/(\d+))"/);
    if (!link) continue;
    const nationality = row.match(/<img\b[^>]*\/flagge\/[^>]*title="([^"]+)"/s)?.[1];
    const name = row.match(/<a\b[^>]*class="wichtig"[^>]*>([^<]+)<\/a>/)?.[1];
    assert.ok(name && nationality, `Hiányzó játékosadat: ${link[2]}`);
    roster.push({ id: link[2], name, url: `https://www.transfermarkt.com${link[1]}`, nationality, clubId, club: teams.find(t => t.id === clubId).name, starter: /Starting/.test(heading), lineupValue: money(row) });
  }
}
assert.ok(roster.length >= 22 && roster.length <= 46);
assert.equal(new Set(roster.map(p => p.id)).size, roster.length);
assert.equal(roster.filter(p => p.starter).length, 22);
const substituteIds = new Set(snapshot?.substituteIds || [...sheet.matchAll(/class="sb-aktion-wechsel-ein"([\s\S]*?)<\/a>/g)].map(m => m[1].match(/\/spieler\/(\d+)/)?.[1]));
assert.ok(substituteIds.size <= 12);
const profiles = (await source(`https://tmapi.transfermarkt.technology/players?${roster.map(p => `ids[]=${p.id}`).join('&')}`)).data;
const profileMap = new Map(profiles.map(p => [String(p.id), p]));
const historySnapshotPath = path.join(import.meta.dirname, 'sources', `market-history-${AS_OF}.json`);
const historySnapshot = fs.existsSync(historySnapshotPath) ? JSON.parse(fs.readFileSync(historySnapshotPath, 'utf8')).players : {};
for (const p of roster) {
  assert.ok(profileMap.has(p.id), `Hiányzó profil: ${p.id}`);
  p.name ||= profileMap.get(p.id).name;
  p.url ||= `https://www.transfermarkt.com${profileMap.get(p.id).relativeUrl}`;
  profileMap.get(p.id).marketValueDetails ||= { current: {}, highest: {} };
}
async function historyFor(p) {
  const current = profileMap.get(p.id).marketValueDetails.current;
  const peak = profileMap.get(p.id).marketValueDetails.highest;
  if (Object.hasOwn(historySnapshot, p.id)) {
    p.historySource = { date: AS_OF, method: 'browser-verified selected points' };
    return { list: historySnapshot[p.id].map(([x, y, datum_mw, verein]) => ({ x, y, datum_mw, verein })) };
  }
  const url = `https://www.transfermarkt.com/ceapi/marketValueDevelopment/graph/${p.id}`;
  const cached = archivedSource(url, true, AS_OF);
  const points = cached?.data?.list || [];
  const last = [...points].sort((a, b) => a.x - b.x).at(-1);
  // A current API profile confirms that this archived timeline's latest
  // valuation and peak have not changed since it was collected.
  if (last && last.y === current.value && last.datum_mw === current.determined?.split('-').reverse().join('/') && Math.max(...points.map(p => p.y)) === peak.value) {
    p.historySource = { date: cached.date, method: 'archived history, latest and peak verified against current API' };
    return cached.data;
  }
  return source(url);
}
let next = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < roster.length) {
    const p = roster[next++];
    const [perf, national, graph] = await Promise.all([
      source(`https://tmapi.transfermarkt.technology/player/${p.id}/performance-game`),
      source(`https://tmapi.transfermarkt.technology/player/${p.id}/national-career-history`),
      historyFor(p),
    ]);
    const game = perf.data.performance.find(g => String(g.gameInformation.gameId) === GAME);
    p.played = p.starter || substituteIds.has(p.id);
    const apiPlayed = game?.statistics?.generalStatistics?.participationState === 'played' || Number(game?.statistics?.playingTimeStatistics?.playedMinutes) > 0;
    assert.equal(Boolean(apiPlayed), p.played, `Eltérő pályára lépés: ${p.name}`);
    if (game) {
      assert.equal(String(game.clubsInformation.club.clubId), p.clubId);
      assert.equal(game.gameInformation.date.dateTimeUTC.slice(0, 10), DATE);
    }
    p.minutes = game?.statistics?.playingTimeStatistics?.playedMinutes || 0;
    p.profile = profileMap.get(p.id);
    p.nationalHistory = national.data.history;
    p.graph = graph.list || [];
    p.atMatch = [...p.graph].filter(v => Number(v.x) <= Date.parse(`${DATE}T23:59:59Z`)).sort((a, b) => a.x - b.x).at(-1) || null;
    p.top5 = {};
    for (const g of perf.data.performance) {
      const league = g.gameInformation.competitionId;
      const mins = Number(g.statistics?.playingTimeStatistics?.playedMinutes) || 0;
      if (!(league in leagueNames) || g.gameInformation.isNationalGame || (g.statistics?.generalStatistics?.participationState !== 'played' && mins <= 0)) continue;
      p.top5[league] ||= { name: leagueNames[league], apps: 0, minutes: 0 };
      p.top5[league].apps++; p.top5[league].minutes += mins;
    }
    console.log(`${p.played ? 'Játszott' : 'Csak pad'}: ${p.name} (${p.minutes}p)`);
  }
}));
const clubIds = [...new Set([...teamIds, ...roster.flatMap(p => [...p.nationalHistory.map(n => n.clubId), ...p.profile.clubAssignments.filter(a => a.type === 'current').map(a => a.clubId)])])];
const clubs = new Map();
for (let i = 0; i < clubIds.length; i += 40) {
  const data = (await source(`https://tmapi.transfermarkt.technology/clubs?${clubIds.slice(i, i + 40).map(id => `ids[]=${id}`).join('&')}`)).data;
  for (const c of data) clubs.set(String(c.id), c);
}
for (const p of roster) {
  p.senior = p.nationalHistory.filter(n => Number(n.gamesPlayed) > 0 && !/\b(?:u\s?1[56789]|u\s?2[013]|under[- ]?(?:17|18|19|20|21|23)|olympic|b team|ii|a2)\b/i.test(clubs.get(String(n.clubId))?.name || '')).map(n => ({ ...n, name: clubs.get(String(n.clubId))?.name }));
  p.currentClub = clubs.get(String(p.profile.clubAssignments.find(a => a.type === 'current')?.clubId))?.name || 'Free agent';
}
const historical = { ...snapshot?.historical };
for (const table of elements(cutoff, 'table')) {
  if (!/Value.*01\/10\/2026/s.test(strip(table))) continue;
  const head = table.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/)?.[1] || '';
  const heads = elements(head, 'th').map(strip);
  const idx = heads.findIndex(h => h === 'Value 01/10/2026');
  assert.ok(idx >= 0, 'Nem az október 1-jei értékoszlopot találtuk');
  const body = table.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)?.[1] || '';
  for (const row of elements(body, 'tr')) {
    const clubId = row.match(/\/verein\/(\d+)/)?.[1];
    if (!teamIds.includes(clubId)) continue;
    historical[clubId] = money(elements(row, 'td')[idx]);
  }
}
assert.ok(teamIds.every(id => historical[id] > 0), 'Hiányzó cutoff érték');
const totals = {};
for (const clubId of teamIds) {
  const players = roster.filter(p => p.clubId === clubId);
  totals[clubId] = { count: players.length, starters: players.filter(p => p.starter).length, played: players.filter(p => p.played).length, value: players.reduce((n, p) => n + (Number(p.atMatch?.y) || 0), 0), unvaluedIds: players.filter(p => !p.atMatch?.y).map(p => p.id) };
}
for (const p of roster) {
  p.graph = p.graph.filter(point => Number(point.y) === Number(p.profile.marketValueDetails.highest.value));
  p.profile = { marketValueDetails: p.profile.marketValueDetails };
  delete p.nationalHistory;
}
const attendanceText = strip(sheet).match(/\bAttendance:\s*([\d][\d.,\s\u00a0]*)/i)?.[1];
const attendance = snapshot?.attendance ?? (attendanceText ? Number(attendanceText.replace(/\D/g, '')) : null);
if (attendance !== null) assert.ok(Number.isSafeInteger(attendance) && attendance > 0, 'Érvénytelen nézőszám');
const report = { asOf: AS_OF, ...config, season: '2026/27', competition: 'Romanian SuperLiga', cutoff: '2026-10-01', historical, totals, attendance, attendanceNote: attendance !== null ? 'Transfermarkt match sheet: Attendance.' : 'Attendance is not present in the freshly retrieved Transfermarkt match sheet.', sources: { lineupUrl, sheetUrl, cutoffUrl }, roster };
report.currentTeamValues = Object.fromEntries(teamIds.map(id => [id, clubs.get(id)?.squadDetails?.currentMarketValue?.value ?? null]));
fs.writeFileSync(path.join(import.meta.dirname, `match-${GAME}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ historical, totals, played: roster.filter(p => p.played).map(p => ({ id: p.id, name: p.name, top5: p.top5, senior: p.senior })) }, null, 2));
