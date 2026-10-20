import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AS_OF } from './source-cache.mjs';
import { aggregateTop5, seniorEntries } from './refresh-current-data.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const attr = (row, key) => row.match(new RegExp(`\\b${key}="([^"]*)"`))?.[1] || '';
const rows = file => [...read(file).matchAll(/<tr\b[^>]*data-player-id="\d+"[^>]*>[\s\S]*?<\/tr>/g)].map(m => m[0]);
const cached = url => JSON.parse(read(`tools/.cache/${AS_OF}/${createHash('sha256').update(url).digest('hex')}.json`));
const files = ['TOP 5 players Seen Live.html', 'Capped Players Seen Live.html', 'Euro-WC Players Seen Live.html', 'Romanian Club-National Players Seen Live.html', 'All Players Seen Live.html'];
const all = files.flatMap(rows);
const ids = [...new Set(all.map(r => attr(r, 'data-player-id')))].sort((a, b) => Number(a) - Number(b));
const batches = ids => Array.from({ length: Math.ceil(ids.length / 45) }, (_, i) => ids.slice(i * 45, (i + 1) * 45));
const profiles = new Map(batches(ids).flatMap(batch => cached(`https://tmapi.transfermarkt.technology/players?${batch.map(id => `ids[]=${id}`).join('&')}`).data).map(p => [String(p.id), p]));
const national = new Map(ids.map(id => [id, cached(`https://tmapi.transfermarkt.technology/player/${id}/national-career-history`).data]));
const matchIds = [...read('All Seen Matches.html').matchAll(/data-(?:home|away)-club-id="(\d+)"/g)].map(m => m[1]);
const clubIds = [...new Set([...matchIds, ...[...profiles.values()].flatMap(p => p.clubAssignments.filter(a => a.type === 'current').map(a => String(a.clubId))), ...[...national.values()].flatMap(n => n.clubIds.map(String))])].sort((a, b) => Number(a) - Number(b));
const clubs = new Map(batches(clubIds).flatMap(batch => cached(`https://tmapi.transfermarkt.technology/clubs?${batch.map(id => `ids[]=${id}`).join('&')}`).data).map(c => [String(c.id), c]));
for (const [row] of read('All Seen Matches.html').matchAll(/<tr\b[^>]*data-home-club-id="\d+"[^>]*>[\s\S]*?<\/tr>/g)) {
  for (const [side, label] of [['home', 'Hazai'], ['away', 'Vendég']]) {
    const id = attr(row, `data-${side}-club-id`);
    const cell = row.match(new RegExp(`<td[^>]*data-label="${label} jelenlegi MV"[^>]*>([\\s\\S]*?)<\\/td>`))[1];
    const value = cell.match(/€([\d.]+)(m|k)/);
    const displayed = value ? Number(value[1]) * (value[2] === 'm' ? 1e6 : 1000) : 0;
    const expected = Number(clubs.get(id).squadDetails?.currentMarketValue?.value || 0);
    // Displayed team totals use two decimal million rounding.
    assert.ok(Math.abs(displayed - expected) <= (expected >= 1e6 ? 5000 : 500), `Aktuális csapatérték: ${id}`);
    if (!expected) assert.equal(cell, '', `Érték nélküli csapat cellája maradjon üres: ${id}`);
  }
}
for (const row of all) {
  const id = attr(row, 'data-player-id'), p = profiles.get(id);
  assert.equal(Number(attr(row, 'data-current-mv')), Number(p.marketValueDetails?.current?.value || 0), `Jelenlegi MV: ${id}`);
  assert.equal(Number(attr(row, 'data-peak')), Number(p.marketValueDetails?.highest?.value || 0), `Peak MV: ${id}`);
}
const top = new Map(rows(files[0]).map(r => [attr(r, 'data-player-id'), r]));
const capped = new Map(rows(files[1]).map(r => [attr(r, 'data-player-id'), r]));
for (const id of ids) {
  const performance = cached(`https://tmapi.transfermarkt.technology/player/${id}/performance-game`).data.performance;
  const leagues = aggregateTop5(performance);
  assert.equal(top.has(id), leagues.size > 0, `Top-5 jogosultság: ${id}`);
  if (top.has(id)) {
    assert.equal(Number(attr(top.get(id), 'data-total-apps')), [...leagues.values()].reduce((n, s) => n + s.apps, 0));
    for (const [league, s] of leagues) assert.ok(top.get(id).includes(`class="badge league-${league}"`) && top.get(id).includes(`· ${s.apps} / ${s.minutes}p</span>`));
  }
  const senior = seniorEntries(national.get(id).history, clubs);
  assert.equal(capped.has(id), senior.length > 0, `Felnőtt válogatott jogosultság: ${id}`);
  if (capped.has(id)) assert.equal(Number(attr(capped.get(id), 'data-total-apps')), senior.reduce((n, s) => n + Number(s.gamesPlayed), 0), `Válogatottság: ${id}`);
}
const labels = ['France', 'Romania U21', 'France U22', 'Portugal B', 'Romania II', 'Turkey A2', 'Slovenia Olympic', 'Spain Amateur'];
const testClubs = new Map(labels.map((name, i) => [String(i), { name }]));
assert.deepEqual(seniorEntries(labels.map((_, i) => ({ clubId: i, gamesPlayed: 1 })), testClubs).map(e => e.clubId), [0]);
const played = (league, state, minutes, national = false) => ({ gameInformation: { competitionId: league, isNationalGame: national }, statistics: { generalStatistics: { participationState: state }, playingTimeStatistics: { playedMinutes: minutes } } });
assert.deepEqual([...aggregateTop5([played('IT1', 'played', 0), played('IT1', 'in squad', 0), played('GB1', 'played', 10), played('GB1', 'played', 90, true), played('GB2', 'played', 90)])], [['GB1', { apps: 1, minutes: 10 }], ['IT1', { apps: 1, minutes: 0 }]]);
console.log(`OK: ${ids.length} játékos aktuális értékei, teljes Top-5/válogatott jogosultsága és szereplési adatai egyeznek a friss forrással.`);
