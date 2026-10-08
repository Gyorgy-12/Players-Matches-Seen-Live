import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { AS_OF, source } from './source-cache.mjs';

export const GAME = '4914561';
export const DATE = '2026-10-08';
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
const sheetUrl = `https://www.transfermarkt.com/spielbericht/index/spielbericht/${GAME}`;
const cutoffUrl = 'https://www.transfermarkt.com/x/marktwerteverein/wettbewerb/RO1/stichtag/2026-10-01/plus/1';
const [lineup, sheet, cutoff] = await Promise.all([source(lineupUrl, false), source(sheetUrl, false, 4, { refresh: true }), source(cutoffUrl, false)]);
assert.match(strip(sheet), /08\/10\/2026/);
assert.match(strip(sheet), /1:3\s*\(\s*1:\s*0\)/);
const headers = [...lineup.matchAll(/<h2\b[^>]*>[\s\S]*?<\/h2>/g)];
const roster = [];
for (let i = 0; i < headers.length; i++) {
  const heading = headers[i][0];
  if (!/Starting Line-up|Substitutes/.test(heading)) continue;
  const clubId = heading.match(/\/verein\/(\d+)/)?.[1];
  assert.ok(['7769', '6429'].includes(clubId));
  const chunk = lineup.slice(headers[i].index + heading.length, headers[i + 1]?.index || lineup.length);
  const table = elements(chunk, 'table')[0];
  for (const row of elements(table, 'tr')) {
    const link = row.match(/href="(\/[^"/]+\/profil\/spieler\/(\d+))"/);
    if (!link) continue;
    const nationality = row.match(/<img\b[^>]*\/flagge\/[^>]*title="([^"]+)"/s)?.[1];
    const name = row.match(/<a\b[^>]*class="wichtig"[^>]*>([^<]+)<\/a>/)?.[1];
    assert.ok(name && nationality, `Hiányzó játékosadat: ${link[2]}`);
    roster.push({ id: link[2], name, url: `https://www.transfermarkt.com${link[1]}`, nationality, clubId, club: clubId === '7769' ? 'CFR Cluj' : 'U Cluj', starter: /Starting/.test(heading), lineupValue: money(row) });
  }
}
assert.equal(roster.length, 46);
assert.equal(new Set(roster.map(p => p.id)).size, 46);
assert.equal(roster.filter(p => p.starter).length, 22);
const substituteIds = new Set([...sheet.matchAll(/class="sb-aktion-wechsel-ein"([\s\S]*?)<\/a>/g)].map(m => m[1].match(/\/spieler\/(\d+)/)?.[1]));
assert.equal(substituteIds.size, 10);
const profiles = (await source(`https://tmapi.transfermarkt.technology/players?${roster.map(p => `ids[]=${p.id}`).join('&')}`)).data;
const profileMap = new Map(profiles.map(p => [String(p.id), p]));
let next = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < roster.length) {
    const p = roster[next++];
    const [perf, national, graph] = await Promise.all([
      source(`https://tmapi.transfermarkt.technology/player/${p.id}/performance-game`),
      source(`https://tmapi.transfermarkt.technology/player/${p.id}/national-career-history`),
      source(`https://www.transfermarkt.com/ceapi/marketValueDevelopment/graph/${p.id}`),
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
const clubIds = [...new Set(roster.flatMap(p => [...p.nationalHistory.map(n => n.clubId), ...p.profile.clubAssignments.filter(a => a.type === 'current').map(a => a.clubId)]))];
const clubs = new Map();
for (let i = 0; i < clubIds.length; i += 40) {
  const data = (await source(`https://tmapi.transfermarkt.technology/clubs?${clubIds.slice(i, i + 40).map(id => `ids[]=${id}`).join('&')}`)).data;
  for (const c of data) clubs.set(String(c.id), c);
}
for (const p of roster) {
  p.senior = p.nationalHistory.filter(n => Number(n.gamesPlayed) > 0 && !/\b(?:u\s?1[56789]|u\s?2[013]|under[- ]?(?:17|18|19|20|21|23)|olympic|b team|ii|a2)\b/i.test(clubs.get(String(n.clubId))?.name || '')).map(n => ({ ...n, name: clubs.get(String(n.clubId))?.name }));
  p.currentClub = clubs.get(String(p.profile.clubAssignments.find(a => a.type === 'current')?.clubId))?.name || 'Free agent';
}
const historical = {};
for (const table of elements(cutoff, 'table')) {
  if (!/Value.*01\/10\/2026/s.test(strip(table))) continue;
  const head = table.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/)?.[1] || '';
  const heads = elements(head, 'th').map(strip);
  const idx = heads.findIndex(h => h === 'Value 01/10/2026');
  assert.ok(idx >= 0, 'Nem az október 1-jei értékoszlopot találtuk');
  const body = table.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)?.[1] || '';
  for (const row of elements(body, 'tr')) {
    const clubId = row.match(/\/verein\/(\d+)/)?.[1];
    if (!['7769', '6429'].includes(clubId)) continue;
    historical[clubId] = money(elements(row, 'td')[idx]);
  }
}
assert.ok(historical['7769'] > 0 && historical['6429'] > 0, 'Hiányzó cutoff érték');
const totals = {};
for (const clubId of ['7769', '6429']) {
  const players = roster.filter(p => p.clubId === clubId);
  totals[clubId] = { count: players.length, starters: players.filter(p => p.starter).length, played: players.filter(p => p.played).length, value: players.reduce((n, p) => n + (Number(p.atMatch?.y) || 0), 0), unvaluedIds: players.filter(p => !p.atMatch?.y).map(p => p.id) };
}
for (const p of roster) {
  p.graph = p.graph.filter(point => Number(point.y) === Number(p.profile.marketValueDetails.highest.value));
  p.profile = { marketValueDetails: p.profile.marketValueDetails };
  delete p.nationalHistory;
}
const attendanceText = strip(sheet).match(/\bAttendance:\s*([\d][\d.,\s\u00a0]*)/i)?.[1];
const attendance = attendanceText ? Number(attendanceText.replace(/\D/g, '')) : null;
if (attendance !== null) assert.ok(Number.isSafeInteger(attendance) && attendance > 0, 'Érvénytelen nézőszám');
const report = { asOf: AS_OF, gameId: GAME, date: DATE, score: '1:3', season: '2026/27', round: 'Matchday 4', competition: 'Romanian SuperLiga', cutoff: '2026-10-01', historical, totals, attendance, attendanceNote: attendance !== null ? 'Transfermarkt match sheet: Attendance.' : 'Attendance is not present in the freshly retrieved Transfermarkt match sheet.', sources: { lineupUrl, sheetUrl, cutoffUrl }, roster };
fs.writeFileSync(path.join(import.meta.dirname, `match-${GAME}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ historical, totals, played: roster.filter(p => p.played).map(p => ({ id: p.id, name: p.name, top5: p.top5, senior: p.senior })) }, null, 2));
