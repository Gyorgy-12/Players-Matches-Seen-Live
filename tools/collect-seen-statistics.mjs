import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { AS_OF, source } from './source-cache.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&nbsp;/g, ' ');
const strip = s => decode(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const attr = (s, k) => decode(s.match(new RegExp(`\\b${k}="([^"]*)"`))?.[1]);
const matches = [...read('All Seen Matches.html').matchAll(/<tr\b[^>]*data-home-club-id="\d+"[^>]*>[\s\S]*?<\/tr>/g)].map(([row]) => {
  const names = strip(row.match(/<a\b[^>]*href="[^"]*spielbericht\/\d+"[^>]*>([\s\S]*?)<\/a>/)?.[1]).split(/\s+-\s+/);
  assert.equal(names.length, 2);
  const score = row.match(/class="score"[^>]*>(\d+):(\d+)/);
  assert.ok(score, 'Hiányzó meccseredmény');
  return { id: row.match(/spielbericht\/(\d+)/)[1], date: new Date(Number(attr(row, 'data-date'))).toISOString().slice(0, 10), season: attr(row, 'data-season'), competition: attr(row, 'data-competition'), home: attr(row, 'data-home-club-id'), away: attr(row, 'data-away-club-id'), homeName: names[0], awayName: names[1], goalsHome: Number(score[1]), goalsAway: Number(score[2]) };
});
// Shootout conversions are not match goals, nor match-time penalty attempts.
for (const m of matches) if (m.id === '4897219') [m.goalsHome, m.goalsAway] = [0, 0]; else if (m.id === '4568309') [m.goalsHome, m.goalsAway] = [1, 1];
const matchMap = new Map(matches.map(m => [m.id, m]));
const candidates = new Map();
const fallback = new Map();
for (const file of ['TOP 5 players Seen Live.html', 'Capped Players Seen Live.html', 'Euro-WC Players Seen Live.html', 'Romanian Club-National Players Seen Live.html']) {
  for (const [row] of read(file).matchAll(/<tr\b[^>]*data-player-id="\d+"[^>]*>[\s\S]*?<\/tr>/g)) {
    const id = attr(row, 'data-player-id');
    const gameId = row.match(/spielbericht\/(\d+)/)?.[1];
    const name = strip(row.match(/<td[^>]*data-label="Játékos"[^>]*>[\s\S]*?<strong>([^<]+)/)?.[1]);
    candidates.set(id, { id, name, nationality: attr(row, 'data-nationality') });
    const m = matchMap.get(gameId);
    const team = attr(row, 'data-seen-club') || attr(row, 'data-club');
    if (m) fallback.set(`${id}|${gameId}`, { player: id, match: gameId, team: team === m.homeName ? m.home : team === m.awayName ? m.away : null });
  }
}
async function parallel(items, fn, label, limit = 8) {
  let next = 0, done = 0;
  const out = new Array(items.length);
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
      if (++done % 50 === 0 || done === items.length) console.log(`${label}: ${done}/${items.length}`);
    }
  }));
  return out;
}
await parallel(matches, async m => {
  const html = await source(`https://www.transfermarkt.com/-/aufstellung/spielbericht/${m.id}`, false);
  for (const [, slug, id] of html.matchAll(/href="\/([^"/]+)\/profil\/spieler\/(\d+)"/g)) if (!candidates.has(id)) candidates.set(id, { id, slug });
}, 'Meccskeretek');
const appearances = [];
const benchCards = [];
const rawCardKeys = new Set();
const positive = n => Math.max(0, Number(n) || 0);
await parallel([...candidates.values()], async p => {
  const perf = await source(`https://tmapi.transfermarkt.technology/player/${p.id}/performance-game`);
  assert.ok(Array.isArray(perf.data?.performance), `Hiányos játékosadat: ${p.id}`);
  for (const g of perf.data.performance) {
    const gameId = String(g.gameInformation.gameId);
    const m = matchMap.get(gameId);
    if (!m) continue;
    const team = String(g.clubsInformation.club.clubId);
    assert.ok([m.home, m.away].includes(team), `Nem résztvevő klub: ${p.id}/${gameId}/${team}`);
    const s = g.statistics, goal = s.goalStatistics, card = s.cardStatistics;
    Object.keys(card || {}).forEach(k => rawCardKeys.add(k));
    // A credited match goal also proves participation when a lower-league
    // report has scorers but no complete lineup (Csiki, Gheorgheni–Ceahlăul).
    const played = s.generalStatistics?.participationState === 'played' || Number(s.playingTimeStatistics?.playedMinutes) > 0 || Number(goal?.goalsScoredTotal) > 0;
    if (!played) fallback.delete(`${p.id}|${gameId}`); // Explicit unused bench is not an appearance.
    const known = [goal?.goalsScoredTotal, goal?.assists, card?.yellowCardGross, goal?.penaltyShooterAttempts, s.playingTimeStatistics?.playedMinutes].every(v => v !== null && v !== undefined);
    const record = { player: p.id, match: gameId, team, minutes: s.playingTimeStatistics?.playedMinutes ?? null, known, goals: goal?.goalsScoredTotal ?? null, assists: goal?.assists ?? null, ownGoals: goal?.ownGoalsScored ?? null,
      // Gross includes the first caution even after a second yellow. Count the
      // second caution separately; a dismissal is one red, never two.
      yellow: card?.yellowCardGross != null ? positive(card.yellowCardGross) + Number(Boolean(card.yellowRedCard)) : null,
      red: card?.fairPlayPoints != null || card?.redCard || card?.yellowRedCard ? Number(Boolean(card.redCard || card.yellowRedCard)) : null,
      secondYellow: card ? Number(Boolean(card.yellowRedCard)) : null,
      penalties: goal?.penaltyShooterAttempts ?? null,
      penaltyGoals: goal?.penaltyShooterGoalsScored ?? null,
      penaltiesWon: goal?.penaltiesReceived ?? null,
      penaltiesCaused: goal?.penaltiesCaused ?? null };
    if (played) {
      appearances.push(record);
      fallback.delete(`${p.id}|${gameId}`);
    } else if (record.yellow || record.red) benchCards.push(record);
  }
}, 'Minden játékos meccsstatisztikája');
for (const record of fallback.values()) {
  assert.ok(record.team, `Ismeretlen látáskori csapat: ${JSON.stringify(record)}`);
  appearances.push({ ...record, minutes: null, known: false, goals: null, assists: null, ownGoals: null, yellow: null, red: null, secondYellow: null, penalties: null, penaltyGoals: null, penaltiesWon: null, penaltiesCaused: null });
}
assert.equal(new Set(appearances.map(p => `${p.player}|${p.match}`)).size, appearances.length);
const actualIds = [...new Set([...appearances, ...benchCards].map(p => p.player))];
const profilesNeeded = actualIds.filter(id => !candidates.get(id)?.name);
for (let i = 0; i < profilesNeeded.length; i += 45) {
  const data = await source(`https://tmapi.transfermarkt.technology/players?${profilesNeeded.slice(i, i + 45).map(id => `ids[]=${id}`).join('&')}`);
  for (const p of data.data) candidates.set(String(p.id), { ...candidates.get(String(p.id)), name: p.name });
}
const players = actualIds.map(id => candidates.get(id));
assert.ok(players.every(p => p.name), 'Hiányzó játékosnév');
const teams = Object.fromEntries(matches.flatMap(m => [[m.home, m.homeName], [m.away, m.awayName]]));
const coverage = matches.map(m => {
  const a = appearances.filter(a => a.match === m.id);
  const home = a.filter(a => a.team === m.home), away = a.filter(a => a.team === m.away);
  const homeGoals = home.reduce((n, a) => n + (a.goals || 0), 0) + away.reduce((n, a) => n + (a.ownGoals || 0), 0);
  const awayGoals = away.reduce((n, a) => n + (a.goals || 0), 0) + home.reduce((n, a) => n + (a.ownGoals || 0), 0);
  return { match: m.id, players: a.length, unknown: a.filter(a => !a.known).length, homeGoals, awayGoals, expected: [m.goalsHome, m.goalsAway], complete: home.length >= 11 && away.length >= 11 && a.every(a => a.known) && homeGoals === m.goalsHome && awayGoals === m.goalsAway };
});
const data = { asOf: AS_OF, matches, players, teams, appearances, benchCards, coverage };
fs.writeFileSync(path.join(import.meta.dirname, 'seen-statistics.json'), JSON.stringify(data, null, 2));
console.log(JSON.stringify({ players: players.length, appearances: appearances.length, teams: Object.keys(teams).length, benchCards: benchCards.length, rawCardKeys: [...rawCardKeys], incomplete: coverage.filter(c => !c.complete) }, null, 2));
