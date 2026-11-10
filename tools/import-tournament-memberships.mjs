import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { sortRowsByPeak } from './refresh-current-data.mjs';
import { reconcileMetadata } from './reconcile-static-metadata.mjs';
import { writeGenerated } from './write-generated.mjs';

const path = file => fileURLToPath(new URL(`../${file}`, import.meta.url));
const read = file => fs.readFileSync(path(file), 'utf8');
const snapshot = JSON.parse(read('tools/sources/tournament-memberships-4921829.json'));
const fixture = JSON.parse(read(`tools/match-${snapshot.gameId}.json`));
const rows = html => [...html.matchAll(/<tr\b[^>]*data-player-id="\d+"[^>]*>[\s\S]*?<\/tr>/g)].map(m => m[0]);
const attr = (row, name) => row.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const esc = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const cell = (label, inner) => `<td data-label="${label}">${inner}</td>`;
const strong = text => `<strong>${esc(text)}</strong>`;
const dateByTournament = { wc2018: '2018-06-14', euro2021: '2021-06-11', wc2022: '2022-11-20', euro2024: '2024-06-14', wc2026: '2026-06-11' };
const file = 'Euro-WC Players Seen Live.html';
let html = read(file);
const tournamentStats = JSON.parse(html.match(/const STATS = (\{[^\n]+\});/)[1]);
const isDerby = row => row.includes(`spielbericht/${snapshot.gameId}"`);
const appearances = new Map(rows(read('All Players Seen Live.html')).filter(isDerby).map(r => [attr(r, 'data-player-id'), r]));
const keys = new Set();
const added = snapshot.memberships.map(([id, tournament, nation, club, value, snapshotDate]) => {
  const row = appearances.get(id), start = dateByTournament[tournament];
  assert.ok(row && fixture.roster.some(p => p.id === id && p.played));
  assert.ok(snapshot.sources[tournament] && start && snapshotDate.split('/').reverse().join('-') <= start);
  assert.ok(!keys.has(`${id}|${tournament}`));
  keys.add(`${id}|${tournament}`);
  const getCell = label => {
    const result = row.match(new RegExp(`<td\\b[^>]*data-label="${label}"[^>]*>[\\s\\S]*?<\\/td>`));
    assert.ok(result, `${id}: ${label}`);
    return result[0];
  };
  const attrs = { 'data-tournament': tournament, 'data-player-id': id, 'data-player': attr(row, 'data-player'), 'data-season': fixture.season, 'data-seen-club': attr(row, 'data-club'), 'data-nationality': attr(row, 'data-nationality'), 'data-status': attr(row, 'data-status'), 'data-current-mv': attr(row, 'data-current-mv'), 'data-peak': attr(row, 'data-peak') };
  return `<tr ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}>
${cell('Torna', strong(tournamentStats[tournament].label))}
${getCell('Játékos')}
${cell('Torna-válogatott', strong(nation))}
${cell('Tornakori klub', `${strong(club)}<span>hivatalos torna-keretlista · ${start}</span>`)}
${cell('Tornakori MV', `<span class="value">€${(value / 1e6).toFixed(2)}m</span><span>TM snapshot: ${snapshotDate} · utolsó TM snapshot a torna kezdetéig</span>`)}
${getCell('Látott csapat').replace('Látott csapat', 'Látáskor klub')}
${getCell('Látáskori MV').replace('Látáskori MV', 'Látáskor MV')}
${['Mostani klub / státusz', 'Jelenlegi MV', 'All-time Peak MV', 'Peak MV klub', 'Látott meccs / eredmény', 'Verseny', 'Szezon', 'Forduló / fázis / meccsnap'].map(getCell).join('\n').replace('Forduló / fázis / meccsnap', 'Forduló / fázis')}
</tr>`;
});
for (const previous of rows(html).filter(isDerby)) html = html.replace(previous, '');
html = sortRowsByPeak(html.replace('</tbody>', `${added.join('\n')}\n</tbody>`));
assert.equal(rows(html).filter(isDerby).length, snapshot.memberships.length);
writeGenerated(path(file), html);
console.log(reconcileMetadata());
