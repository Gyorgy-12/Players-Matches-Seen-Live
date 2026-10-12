import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const files = ['All Seen Matches.html', 'TOP 5 players Seen Live.html', 'Capped Players Seen Live.html', 'Euro-WC Players Seen Live.html', 'Romanian Club-National Players Seen Live.html'];
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const attr = (r, k) => r.match(new RegExp(`\\b${k}="([^"]*)"`))?.[1] || '';
const rows = h => [...h.matchAll(/<tr\b[^>]*data-(?:player-id|home-club-id)="\d+"[^>]*>[\s\S]*?<\/tr>/g)].map(m => m[0]);
const cell = (r, k) => r.match(new RegExp(`<td[^>]*data-label="${k}"[^>]*>([\\s\\S]*?)<\\/td>`))?.[1] || '';
const game = r => r.match(/spielbericht\/(\d+)/)?.[1] || '';
const key = r => [attr(r, 'data-player-id'), attr(r, 'data-tournament'), game(r)].join('|');
const text = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const match = JSON.parse(read('tools/match-4914525.json'));
const report = JSON.parse(read('tools/refresh-current-data-report.json'));
assert.equal(report.asOf, '2026-10-12');
for (const [name, value] of Object.entries(report.failures)) assert.equal(Array.isArray(value) ? value.length : value, 0, name);
const expectedAdds = [1, 5, 14, 2, 30];
const players = new Map();
const changes = { currentValues: new Set(), currentClubs: new Set(), peaks: new Set(), nationalStats: new Set(), top5Stats: new Set() };
for (const [i, file] of files.entries()) {
  const html = read(file);
  const currentRows = rows(html);
  const before = execFileSync('git', ['show', `HEAD:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 30e6 });
  const oldRows = new Map(rows(before).map(r => [key(r), r]));
  const keys = currentRows.map(key);
  assert.equal(new Set(keys).size, keys.length, `Dupla meccssor: ${file}`);
  assert.equal(currentRows.filter(r => game(r) === match.gameId).length, expectedAdds[i], file);
  for (const oldKey of oldRows.keys()) assert.ok(keys.includes(oldKey), `Elveszett régi sor: ${file}/${oldKey}`);
  for (const row of currentRows) {
    assert.equal([...row.matchAll(/<td\b/g)].length, [11, 14, 14, 15, 12][i], `Oszlopszám: ${file}/${key(row)}`);
    const id = attr(row, 'data-player-id');
    if (!i && attr(row, 'data-attendance-known') === '1') assert.match(cell(row, 'Nézőszám'), /class="value"/, `Hiányzó nézőszám-kiemelés: ${game(row)}`);
    if (id) {
      if (id === '342229') {
        assert.match(cell(row, 'All-time Peak MV'), /17\/12\/2018/);
        assert.match(cell(row, 'Peak MV klub'), /Paris Saint-Germain/);
      }
      const state = ['data-status', 'data-current-mv', 'data-peak'].map(k => attr(row, k));
      const cells = ['Mostani klub / státusz', 'Jelenlegi MV', 'All-time Peak MV', 'Peak MV klub'].map(k => text(cell(row, k)));
      if (players.has(id)) assert.deepEqual([...state, ...cells], players.get(id), `Eltérő friss adatok: ${file}/${id}`);
      else players.set(id, [...state, ...cells]);
      const old = oldRows.get(key(row));
      if (old) {
        for (const [label, set] of [['Jelenlegi MV', 'currentValues'], ['Mostani klub / státusz', 'currentClubs'], ['All-time Peak MV', 'peaks'], ['Válogatott / meccs / gól', 'nationalStats'], ['Top-5 liga/app', 'top5Stats']]) if (text(cell(row, label)) !== text(cell(old, label))) changes[set].add(id);
        for (const label of ['Látáskori MV', 'Látáskor MV', 'Tornakori MV', 'Tornakori klub']) assert.equal(cell(row, label), cell(old, label), `Megváltozott történeti adat: ${id}/${label}`);
      }
    }
    if (game(row) === match.gameId) {
      assert.match(cell(row, i ? 'Látott meccs / eredmény' : 'Mérkőzés / eredmény'), /3:4/);
      assert.match(row, /2026-10-12/);
      assert.equal(attr(row, 'data-season'), '2026/27');
      assert.match(row, /Matchday 11/);
      if (id) assert.ok(match.roster.some(p => p.id === id && p.played), `Nem pályára lépett játékos: ${id}`);
    }
  }
  if (i) {
    const byPlayerDates = new Map();
    for (let j = 0; j < currentRows.length; j++) {
      if (j) assert.ok(Number(attr(currentRows[j - 1], 'data-peak')) >= Number(attr(currentRows[j], 'data-peak')), `Peak sorrend: ${file}/${j}`);
      const row = currentRows[j]; const id = attr(row, 'data-player-id');
      const date = cell(row, 'Látott meccs / eredmény').match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
      assert.ok(date >= (byPlayerDates.get(id) || ''), `Játékoson belüli dátumsorrend: ${file}/${id}`);
      byPlayerDates.set(id, date);
    }
  } else {
    assert.equal(currentRows.length, 93);
    assert.equal(game(currentRows[0]), match.gameId);
    assert.equal(attr(currentRows[0], 'data-sheet-total'), '41250000');
    assert.equal(match.attendance, 9577);
    assert.equal(attr(currentRows[0], 'data-attendance-known'), match.attendance ? '1' : '0');
    assert.equal(Number(attr(currentRows[0], 'data-attendance')), match.attendance || 0);
    if (match.attendance) assert.equal(Number(text(cell(currentRows[0], 'Nézőszám')).replace(/\D/g, '')), match.attendance);
    for (const row of currentRows.slice(1)) {
      const old = oldRows.get(key(row));
      for (const label of ['Meccsnapi összérték', 'Hazai akkori MV', 'Vendég akkori MV']) assert.equal(cell(row, label), cell(old, label));
    }
  }
  for (const [j, script] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].entries()) new vm.Script(script[1], { filename: `${file}:script${j}` });
  console.log(`OK: ${file}: ${currentRows.length} sor`);
}
assert.equal(players.size, 1011);
assert.equal(read('index.html'), read('TM Groundhopping Hub.html'));
const totalRows = files.reduce((n, f) => n + rows(read(f)).length, 0) + ['Player Statistics.html', 'Team Statistics.html'].reduce((n, f) => n + Number(read(f).match(/data-stat-count="(\d+)"/)[1]), 0);
assert.ok(read('index.html').includes(totalRows.toLocaleString('hu-HU', { useGrouping: 'always' })));
assert.equal(Object.values(match.totals).reduce((n, t) => n + t.count, 0), 46);
assert.equal(Object.values(match.totals).reduce((n, t) => n + t.played, 0), 30);
console.log('Frissült régi játékosadatok:', Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.size])));
console.log('Minden adatintegritási ellenőrzés sikeres.');
