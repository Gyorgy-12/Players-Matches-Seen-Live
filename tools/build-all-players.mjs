import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { AS_OF, source } from './source-cache.mjs';
import { archivedSource } from './archived-source.mjs';
import { unifyTeamNames, updateCurrentPlayerRow, sortRowsByPeak, rebuildRomanianSearch } from './refresh-current-data.mjs';
import { normalizeFilterOptionOrder } from './normalize-filter-options.mjs';
import { reconcileMetadata } from './reconcile-static-metadata.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const data = JSON.parse(read('tools/seen-statistics.json'));
const file = 'All Players Seen Live.html';
const template = read('Romanian Club-National Players Seen Live.html');
const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0*39;|&#x27;/gi, "'").replace(/&nbsp;/g, ' ');
const strip = s => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (r, k) => decode(r.match(new RegExp(`\\b${k}="([^"]*)"`))?.[1]);
const cells = row => new Map([...row.matchAll(/<td\b[^>]*data-label="([^"]*)"[^>]*>([\s\S]*?)<\/td>/g)].map(m => [m[1], m[2]]));
const td = (label, html, cls = '') => `<td${cls ? ` class="${cls}"` : ''} data-label="${esc(label)}">${html}</td>`;
const strong = v => `<strong>${esc(v)}</strong>`;
const money = p => p?.y > 0 ? `<span class="value">${p.y >= 1e6 ? `€${(p.y / 1e6).toFixed(2)}m` : `€${Math.round(p.y / 1000)}k`}</span><span>snapshot: ${esc(p.datum_mw)}</span>` : '';
const old = new Map();
for (const name of ['Romanian Club-National Players Seen Live.html', 'Capped Players Seen Live.html', 'TOP 5 players Seen Live.html', 'Euro-WC Players Seen Live.html']) {
  for (const [row] of read(name).matchAll(/<tr\b[^>]*data-player-id="\d+"[^>]*>[\s\S]*?<\/tr>/g)) {
    const id = attr(row, 'data-player-id');
    if (!old.has(id)) old.set(id, row);
  }
}
const matchRows = new Map([...read('All Seen Matches.html').matchAll(/<tr\b[^>]*data-home-club-id="\d+"[^>]*>[\s\S]*?<\/tr>/g)].map(([r]) => [r.match(/spielbericht\/(\d+)/)[1], r]));
const matchMap = new Map(data.matches.map(m => [m.id, m]));
const people = new Map(data.players.map(p => [p.id, p]));
const ids = [...new Set(data.appearances.map(a => a.player))];
const nationality = new Map(ids.map(id => [id, attr(old.get(id) || '', 'data-nationality') || people.get(id)?.nationality || '']));
// Extract primary flags from the archived complete roster rows, including
// the foreign opponent. Inner layout tables must not truncate the outer row.
function elements(html, tag) {
  let depth = 0, start = 0; const result = [];
  for (const m of html.matchAll(new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi'))) {
    if (!m[1]) { if (!depth) start = m.index; depth++; }
    else if (depth && !--depth) result.push(html.slice(start, m.index + m[0].length));
  }
  return result;
}
for (const m of data.matches) {
  const html = archivedSource(`https://www.transfermarkt.com/-/aufstellung/spielbericht/${m.id}`, false, AS_OF)?.data;
  if (!html) continue;
  for (const row of elements(html, 'tr')) {
    const id = row.match(/\/profil\/spieler\/(\d+)/)?.[1];
    const flag = row.match(/<img\b[^>]*\/flagge\/[^>]*title="([^"]+)"/s)?.[1];
    if (id && !nationality.get(id) && flag) nationality.set(id, decode(flag));
  }
}
// Preserve established labels (in particular DR Congo versus Congo).
for (const [id, name] of nationality) if (name === 'The Gambia') nationality.set(id, 'Gambia');
const profiles = new Map(), clubs = new Map();
for (let i = 0; i < ids.length; i += 45) {
  const batch = (await source(`https://tmapi.transfermarkt.technology/players?${ids.slice(i, i + 45).map(id => `ids[]=${id}`).join('&')}`)).data;
  for (const p of batch) profiles.set(String(p.id), p);
}
assert.equal(profiles.size, ids.length, 'Hiányos teljes játékospool');
const clubIds = [...new Set([...profiles.values()].flatMap(p => p.clubAssignments.filter(a => a.type === 'current').map(a => a.clubId)))];
for (let i = 0; i < clubIds.length; i += 45) {
  const batch = (await source(`https://tmapi.transfermarkt.technology/clubs?${clubIds.slice(i, i + 45).map(id => `ids[]=${id}`).join('&')}`)).data;
  for (const c of batch) clubs.set(String(c.id), c);
}
assert.equal(clubs.size, clubIds.length, 'Hiányos klubadatok');
const verified = {};
for (const name of ['market-history-2026-10-20.json', 'all-player-history-2026-10-20.json']) {
  Object.assign(verified, JSON.parse(read(`tools/sources/${name}`)).players);
}
const graphs = new Map(), missing = [];
for (const id of ids) {
  const profile = profiles.get(id);
  const graph = Object.hasOwn(verified, id)
    ? verified[id].map(([x, y, datum_mw, verein]) => ({ x, y, datum_mw, verein }))
    : archivedSource(`https://www.transfermarkt.com/ceapi/marketValueDevelopment/graph/${id}`, true, AS_OF)?.data?.list;
  if (!graph) { missing.push(id); continue; }
  const peak = Math.max(0, ...graph.map(p => Number(p.y) || 0));
  // Old timelines are valid historical sources, but a new career maximum
  // needs a newly verified peak-club/date before exporting.
  if (Number(profile.marketValueDetails?.highest?.value || 0) > peak) { missing.push(id); continue; }
  graphs.set(id, graph);
}
assert.deepEqual(missing, [], `Friss értéktörténetet igénylő játékosok: ${missing.join(', ')}`);
assert.ok(ids.every(id => nationality.get(id)), `Hiányzó nemzetiségek: ${ids.filter(id => !nationality.get(id)).join(', ')}`);
const teamCounts = new Map(ids.map(id => [id, new Set(data.appearances.filter(a => a.player === id).map(a => a.team)).size]));
const appearanceCounts = new Map(ids.map(id => [id, data.appearances.filter(a => a.player === id).length]));
const rows = data.appearances.map(a => {
  const m = matchMap.get(a.match), profile = profiles.get(a.player), previous = old.get(a.player);
  const name = previous ? strip(cells(previous).get('Játékos')?.match(/<strong>([\s\S]*?)<\/strong>/)?.[1]) : profile.name;
  const graph = graphs.get(a.player);
  const atMatch = [...graph].filter(p => p.x <= Date.parse(`${m.date}T23:59:59Z`)).sort((a, b) => a.x - b.x).at(-1);
  const mc = cells(matchRows.get(m.id));
  const round = strip(mc.get('Forduló / fázis / meccsnap'));
  const peak = Math.max(0, ...graph.map(p => Number(p.y) || 0));
  const attrs = {
    'data-player-id': a.player, 'data-player': name, 'data-nationality': nationality.get(a.player),
    'data-club': data.teams[a.team], 'data-competition': m.competition, 'data-season': m.season,
    'data-round': round, 'data-status': 'unknown', 'data-team-count': teamCounts.get(a.player),
    'data-appearance-count': appearanceCounts.get(a.player),
    'data-peak': peak, 'data-seen-mv': atMatch?.y || 0, 'data-current-mv': 0,
    'data-date': m.date, 'data-year': m.date.slice(0, 4), 'data-match-id': m.id,
  };
  let row = `<tr ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}>
${td('Játékos', `<a href="https://www.transfermarkt.com${esc(profile.relativeUrl)}" target="_blank" rel="noopener">${strong(name)}</a><span>${appearanceCounts.get(a.player)} látott meccs · ${teamCounts.get(a.player)} látott csapat · ID: ${a.player}</span>`, 'player-cell')}
${td('Nemzetiség', strong(nationality.get(a.player)))}
${td('Látott csapat', strong(data.teams[a.team]))}
${td('Látáskori MV', money(atMatch))}
${td('Mostani klub / státusz', '')}
${td('Jelenlegi MV', '')}
${td('All-time Peak MV', '')}
${td('Peak MV klub', '')}
${td('Látott meccs / eredmény', mc.get('Mérkőzés / eredmény'), 'match-cell')}
${td('Verseny', strong(m.competition))}${td('Szezon', strong(m.season))}${td('Forduló / fázis / meccsnap', strong(round))}
</tr>`;
  row = updateCurrentPlayerRow(row, profile, clubs, graph);
  return rebuildRomanianSearch(unifyTeamNames(row));
});
assert.equal(new Set(data.appearances.map(a => `${a.player}|${a.match}`)).size, rows.length);
let html = template.replace(/(<tbody\b[^>]*>)[\s\S]*?(<\/tbody>)/, (_, a, b) => a + '\n' + rows.join('\n') + '\n' + b)
  .replace(/Román klubokban látott játékosok/g, 'Minden élőben látott játékos')
  .replace(/ROMÁN KLUBOK/g, 'MINDEN LÁTOTT JÁTÉKOS')
  .replace(/data-tmgh-mode="romanian"/, 'data-tmgh-mode="allplayers"')
  .replace(/data-static-export="[^"]*"/, `data-static-export="${AS_OF}"`)
  .replace(/<p class="muted">[\s\S]*?<\/p>/, `<p class="muted">Az összes látott csapat pályára lépett játékosa · minden látott meccs külön sor · játékosadatok: ${AS_OF}</p>`)
  .replace(/Látáskori román csapat/g, 'Látott csapat').replace(/Minden látott román csapat/g, 'Minden látott csapat')
  .replace(/Román csapatok/g, 'Látott csapatok').replace(/ román csapat/g, ' látott csapat')
  .replace(/különböző látott klub/g, 'különböző látott csapat').replace(/Látott klubok száma/g, 'Látott csapatok száma')
  .replace(/<div class="field"><label>Játékostípus<\/label>[\s\S]*?<\/div>/, '')
  .replace(/type:\s*document\.querySelector\('#type'\),?\s*/g, '')
  .replace(/\(!els\.type\.value \|\| row\.dataset\.type===els\.type\.value\) &&\s*/g, '')
  .replace(/els\.type\.value='';\s*/g, '')
  .replace('<option value="name">Név A–Z</option>', '<option value="name">Név A–Z</option><option value="appearances-desc">Látott meccsek száma ↓</option><option value="appearances-asc">Látott meccsek száma ↑</option>')
  .replace("if (mode==='date-asc')", "if (mode==='appearances-desc') return num(b.dataset.appearanceCount)-num(a.dataset.appearanceCount) || an.localeCompare(bn,'hu') || ad.localeCompare(bd);\n        if (mode==='appearances-asc') return num(a.dataset.appearanceCount)-num(b.dataset.appearanceCount) || an.localeCompare(bn,'hu') || ad.localeCompare(bd);\n        if (mode==='date-asc')");
html = normalizeFilterOptionOrder(sortRowsByPeak(html));
assert.ok(!html.includes('els.type'), 'A román játékostípus-szűrő nem maradhat az összesített nézetben');
fs.writeFileSync(path.join(root, file), html);
// Shared players must show the same current club and valuation in every mode.
// Historical match/tournament cells are intentionally left unchanged.
for (const name of ['Romanian Club-National Players Seen Live.html', 'Capped Players Seen Live.html', 'TOP 5 players Seen Live.html', 'Euro-WC Players Seen Live.html']) {
  let existing = read(name).replace(/<tr\b[^>]*data-player-id="\d+"[^>]*>[\s\S]*?<\/tr>/g, row => {
    const id = attr(row, 'data-player-id');
    if (!profiles.has(id)) return row;
    row = updateCurrentPlayerRow(row, profiles.get(id), clubs, graphs.get(id));
    if (name.startsWith('Romanian')) row = rebuildRomanianSearch(row);
    return row;
  }).replace(/jelenlegi játékosadatok frissítve:\s*\d{4}-\d{2}-\d{2}/g, `jelenlegi játékosadatok frissítve: ${AS_OF}`);
  fs.writeFileSync(path.join(root, name), normalizeFilterOptionOrder(unifyTeamNames(sortRowsByPeak(existing))));
}
for (const hubFile of ['index.html', 'TM Groundhopping Hub.html']) {
  let hub = read(hubFile);
  if (!hub.includes("id:'allplayers'")) hub = hub.replace(/(\{ id:'matches'[^\n]+\},)/, `$1\n        { id:'allplayers', icon:'ÖJ', title:'Minden látott játékos', description:'Az összes csapat pályára lépett játékosai', meta:'${rows.length} sor', file:'${file}' },`);
  hub = hub.replace(/A hét statikus HTML/, 'A nyolc statikus HTML')
    .replace(/(<span>Oldalak<\/span><strong>)\d+(<\/strong>)/, '$18$2')
    .replace("new Set(['capped', 'romanian', 'playerstats', 'teamstats'])", "new Set(['capped', 'romanian', 'allplayers', 'playerstats', 'teamstats'])");
  fs.writeFileSync(path.join(root, hubFile), hub);
}
console.log('Minden látott játékos:', ids.length, 'egyedi játékos,', rows.length, 'meccssor.');
console.log(reconcileMetadata());
