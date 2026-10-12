import fs from 'node:fs';
import assert from 'node:assert/strict';
import '../tmgh-statistics-core.js';
import { normalizeFilterOptionOrder } from './normalize-filter-options.mjs';
const data = JSON.parse(fs.readFileSync(new URL('./seen-statistics.json', import.meta.url), 'utf8'));
const { aggregate } = globalThis.TMGHStatistics;
const players = aggregate(data, 'players', { sort: 'apps' }), teams = aggregate(data, 'teams');
assert.equal(players.length, 1130);
assert.equal(teams.length, 50);
assert.equal(players.reduce((n, r) => n + r.apps, 0), data.appearances.length);
assert.equal(teams.reduce((n, r) => n + r.apps, 0), 2 * data.matches.length);
assert.equal(teams.reduce((n, r) => n + r.goals, 0), data.matches.reduce((n, m) => n + m.goalsHome + m.goalsAway, 0));
assert.equal(teams.reduce((n, r) => n + r.goals, 0), teams.reduce((n, r) => n + r.goalsAgainst, 0));
assert.equal(teams.reduce((n, r) => n + r.difference, 0), 0);
const zeros = aggregate(data, 'players', { direction: 'asc' });
assert.equal(zeros[0].goals, 1);
assert.ok(zeros.every(r => r.goals > 0));
for (const key of ['goals', 'apps', 'assists', 'yellow', 'red', 'penaltyGoals', 'penalties', 'penaltiesWon']) for (const direction of ['asc', 'desc']) {
  const rows = aggregate(data, 'players', { sort: key, direction });
  assert.ok(rows.every(r => r[key] > 0), `Nullás játékos: ${key}/${direction}`);
  assert.ok(rows.every((r, i) => !i || (direction === 'desc' ? rows[i - 1][key] >= r[key] : rows[i - 1][key] <= r[key])));
}
const game = { match: '4914525', sort: 'apps' };
const newPlayers = aggregate(data, 'players', game), newTeams = aggregate(data, 'teams', game);
assert.equal(newPlayers.length, 30);
assert.equal(newPlayers.reduce((n, r) => n + r.goals, 0), 7);
assert.equal(newPlayers.find(r => r.id === '464195').goals, 2);
assert.equal(newPlayers.find(r => r.id === '429551').assists, 3);
assert.equal(newTeams.find(r => r.id === '6429').goals, 3);
assert.equal(newTeams.find(r => r.id === '6429').goalsAgainst, 4);
assert.equal(newTeams.find(r => r.id === '455').wins, 1);
assert.equal(newTeams.reduce((n, r) => n + r.yellow, 0), 8);
assert.equal(aggregate(data, 'players', { ...game, team: '6429' }).length, 15);
assert.equal(aggregate(data, 'players', { ...game, team: '455' }).length, 15);
assert.equal(aggregate(data, 'players', { ...game, query: 'morutan' })[0].assists, 3);
assert.equal(aggregate(data, 'players', { ...game, season: '2025/26' }).length, 0);
assert.equal(aggregate(data, 'players', { ...game, minApps: 2 }).length, 0);
for (const id of ['4897219', '4568309']) {
  const m = data.matches.find(m => m.id === id);
  const ts = aggregate(data, 'teams', { match: id });
  assert.equal(ts.reduce((n, r) => n + r.goals, 0), m.goalsHome + m.goalsAway);
  assert.equal(ts.reduce((n, r) => n + r.penaltyGoals, 0), 0, 'Párbaj nem 11-es gól');
  assert.ok(ts.every(t => t.draws === 1));
}
assert.ok(!data.appearances.some(a => a.player === '457738' && a.match === '4843516'), 'Lukic itt csak cserepadon ült');
assert.equal(data.appearances.find(a => a.player === '863574' && a.match === '4979913').goals, 1);
assert.equal(data.coverage.filter(c => !c.complete).length, 1);
const siafa = players.find(p => /siafa/i.test(p.name));
assert.ok(siafa.apps >= 2);
assert.equal(aggregate(data, 'players', { match: '4914525', sort: 'goals' }).length, 6);
assert.equal(aggregate(data, 'players', { match: '4914525', sort: 'red' }).length, 0);
assert.equal(aggregate(data, 'players', { match: '4914525', sort: 'penaltyGoals' }).length, 0);
assert.equal(aggregate(data, 'players', { match: '4914525', sort: 'assists', direction: 'asc' }).length, 3);
for (const file of ['Player Statistics.html', 'Team Statistics.html']) {
  const html = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.ok(normalizeFilterOptionOrder(html) === html, `${file}: eltérő szűrősorrend`);
  assert.match(html, /<option value="desc">Csökkenő ↓<\/option><option value="asc">Növekvő ↑<\/option>/);
  assert.equal([...html.matchAll(/data-page-size/g)].length, 2);
}
console.log('OK: teljes pool, nullás statok kizárása, újraszámoló szűrők, összes rendezés, új meccs, lapok, párbajok, hiányos forrás és Siafa ismételt látása.');
