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
const teamPenaltyColumns = ['awarded', 'penaltyGoals', 'penaltyMisses', 'penaltiesAgainst', 'penaltyGoalsAgainst', 'penaltyMissesAgainst'];
for (const [own, against] of [['awarded', 'penaltiesAgainst'], ['penaltyGoals', 'penaltyGoalsAgainst'], ['penaltyMisses', 'penaltyMissesAgainst']]) {
  assert.equal(teams.reduce((n, r) => n + r[own], 0), teams.reduce((n, r) => n + r[against], 0), `Büntetők két nézőpontja: ${own}`);
}
for (const key of teamPenaltyColumns) for (const direction of ['asc', 'desc']) {
  const rows = aggregate(data, 'teams', { sort: key, direction, season: '2025/26' });
  assert.ok(rows.every((r, i) => Number.isFinite(r[key]) && r[key] >= 0 && (!i || (direction === 'desc' ? rows[i - 1][key] >= r[key] : rows[i - 1][key] <= r[key]))), `Büntetőrendezés: ${key}/${direction}`);
}
for (const match of data.matches) {
  const home = aggregate(data, 'teams', { match: match.id, team: match.home })[0];
  const away = aggregate(data, 'teams', { match: match.id, team: match.away })[0];
  assert.deepEqual([home.awarded, home.penaltyGoals, home.penaltyMisses], [away.penaltiesAgainst, away.penaltyGoalsAgainst, away.penaltyMissesAgainst], `Hazai büntetők: ${match.id}`);
  assert.deepEqual([away.awarded, away.penaltyGoals, away.penaltyMisses], [home.penaltiesAgainst, home.penaltyGoalsAgainst, home.penaltyMissesAgainst], `Vendég büntetők: ${match.id}`);
}
const cfrDerby = aggregate(data, 'teams', { match: '4914561', team: '7769' })[0];
assert.deepEqual([cfrDerby.penaltiesAgainst, cfrDerby.penaltyGoalsAgainst, cfrDerby.penaltyMissesAgainst], [1, 1, 0]);
const sepsiOlimpija = aggregate(data, 'teams', { match: '3872557', team: '4772' })[0];
assert.deepEqual([sepsiOlimpija.penaltiesAgainst, sepsiOlimpija.penaltyGoalsAgainst, sepsiOlimpija.penaltyMissesAgainst], [2, 0, 2]);
for (const row of aggregate(data, 'teams', { match: '4649052' })) assert.deepEqual(teamPenaltyColumns.map(k => row[k]), [1, 0, 1, 1, 0, 1]);
// Distinguish an unrecorded outcome from a miss; bench-card records cannot
// create attempts, outcomes, or false gaps in penalty coverage.
const fixture = {
  players: [], teams: { home: 'Hazai', away: 'Vendég' },
  matches: [{ id: 'test', home: 'home', away: 'away', goalsHome: 2, goalsAway: 0 }],
  coverage: [{ match: 'test', complete: true }],
  appearances: [
    { match: 'test', team: 'home', penaltiesWon: 4, penalties: 3, penaltyGoals: 2 },
    { match: 'test', team: 'away', penaltiesWon: null, penalties: 0, penaltyGoals: 0 },
  ],
  benchCards: [{ match: 'test', team: 'home', yellow: 1, penalties: null, penaltyGoals: null }],
};
let fixtureHome = aggregate(fixture, 'teams', { team: 'home' })[0];
assert.deepEqual([fixtureHome.awarded, fixtureHome.penaltyGoals, fixtureHome.penaltyMisses, fixtureHome.unknown], [4, 2, 1, 0]);
fixture.appearances[0].penaltyGoals = null;
fixtureHome = aggregate(fixture, 'teams', { team: 'home' })[0];
assert.equal(fixtureHome.penaltyMisses, 0, 'Ismeretlen kimenetel nem kihagyás');
assert.equal(fixtureHome.unknown, 1);
assert.equal(aggregate(fixture, 'teams', { team: 'away' })[0].penaltyMissesAgainst, 0);
fixture.appearances[0].penalties = null;
fixture.appearances[0].penaltiesWon = null;
fixture.appearances[0].penaltyGoals = 1;
fixtureHome = aggregate(fixture, 'teams', { team: 'home' })[0];
assert.deepEqual([fixtureHome.awarded, fixtureHome.penaltyGoals, fixtureHome.penaltyMisses, fixtureHome.unknown], [1, 1, 0, 1]);
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
  assert.ok(ts.every(r => teamPenaltyColumns.every(k => r[k] === 0)), 'Párbaj nem ítélt, értékesített vagy kihagyott meccsbüntető');
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
  assert.equal([...html.matchAll(/class="selected-metric"/g)].length, 50, `${file}: statikus számkiemelés`);
  assert.equal([...html.matchAll(/class="rank"/g)].length, 50, `${file}: statikus sorszámformázás`);
  const columns = JSON.parse(html.match(/id="statistics-columns">([^<]+)<\/script>/)[1]);
  if (file === 'Team Statistics.html') {
    assert.deepEqual(columns.slice(7, 13).map(([key]) => key), teamPenaltyColumns);
    assert.ok(!columns.some(([key]) => key === 'penalties'));
    assert.ok(!html.includes('<option value="penalties">'));
    for (const [key, label] of columns) assert.ok(key === 'name' || html.includes(`<option value="${key}">${label}</option>`));
  } else assert.ok(columns.some(([key]) => key === 'penalties'), 'Játékosok elvégzésszáma megmarad');
}
console.log('OK: teljes pool, nullás statok kizárása, újraszámoló szűrők, összes rendezés, új meccs, lapok, párbajok, hiányos forrás és Siafa ismételt látása.');
