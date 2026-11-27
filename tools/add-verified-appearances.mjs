import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { writeGenerated } from './write-generated.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dataFile = path.join(import.meta.dirname, 'seen-statistics.json');
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const fixtures = new Map(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'verified-off-transfermarkt-fixtures.json'), 'utf8')).map(m => [m.id, m]));
const today = 'local-2026-11-27-u-cluj-sepsi';
const roster = [
  ['935015','6429'],['229625','6429'],['600151','6429'],['331971','6429'],['64126','6429'],['605547','6429'],['220816','6429'],['798972','6429'],['699171','6429'],['685795','6429'],['457738','6429'],
  ['168278','54585'],['468272','54585'],['406429','54585'],['693029','54585'],['671648','54585'],['860352','54585'],['1338731','54585'],['823719','54585'],['806193','54585'],['212718','54585'],['266865','54585'],
  ['477923','6429'],['880840','6429'],['859536','6429'],['399551','6429'],['418654','54585'],['637514','54585'],['1250111','54585'],['813000','54585']
];
const extras = [
  ['224170','39835','local-2026-05-01-sanatatea-poli'],
  ['703147','113127','local-2026-09-23-gheorgheni-onesti'],
  ['97532','113127','local-2022-06-25-gheorgheni-mse']
];
const records = [...roster.map(([player, team]) => ({ player, team, match: today })), ...extras.map(([player, team, match]) => ({ player, team, match }))];
assert.equal(new Set(records.map(a => `${a.player}|${a.match}`)).size, records.length);
data.players.push(...([{ id:'418654', name:'Victor Daguin', nationality:'France' }].filter(p => !data.players.some(old => old.id === p.id))));
const events = {
  '806193': { goals:1, yellow:1 }, '823719': { assists:1 }, '457738': { yellow:1 }, '418654': { yellow:1 },
  '224170': { goals:1 }, '703147': { goals:1 }, '97532': { goals:1, penalties:1, penaltyGoals:0 }
};
for (const a of records) {
  if (data.appearances.some(old => old.player === a.player && old.match === a.match)) continue;
  assert.ok(data.players.some(p => p.id === a.player), `Ismeretlen játékos: ${a.player}`);
  data.appearances.push({ ...a, minutes:null, known:false, goals:events[a.player]?.goals ?? null, assists:events[a.player]?.assists ?? null, ownGoals:null, yellow:events[a.player]?.yellow ?? null, red:null, secondYellow:null, penalties:events[a.player]?.penalties ?? null, penaltyGoals:events[a.player]?.penaltyGoals ?? null, penaltiesWon:null, penaltiesCaused:null });
}
for (const m of fixtures.values()) {
  const coverage = data.coverage.find(c => c.match === m.id);
  const seen = data.appearances.filter(a => a.match === m.id);
  coverage.players = seen.length; coverage.unknown = seen.filter(a => !a.known).length;
  coverage.homeGoals = seen.filter(a => a.team === m.home).reduce((n,a) => n + (a.goals || 0), 0);
  coverage.awayGoals = seen.filter(a => a.team === m.away).reduce((n,a) => n + (a.goals || 0), 0);
  coverage.complete = false;
}
const esc = value => String(value ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const attr = (row, key) => row.match(new RegExp(`\\b${key}="([^"]*)"`))?.[1] || '';
const setAttr = (row, key, value) => row.replace(new RegExp(`(\\b${key}=")[^"]*(")`), (_, a, b) => a + esc(value) + b);
const rowId = row => attr(row, 'data-player-id');
const files = ['TOP 5 players Seen Live.html', 'Capped Players Seen Live.html', 'Euro-WC Players Seen Live.html', 'Romanian Club-National Players Seen Live.html', 'All Players Seen Live.html'];
const byId = new Map(data.players.map(p => [p.id, p]));
function clone(row, a, file) {
  const m = fixtures.get(a.match), p = byId.get(a.player), club = data.teams[a.team];
  if (a.player === '418654') {
    row = setAttr(setAttr(setAttr(row, 'data-player-id', p.id), 'data-player', p.name), 'data-nationality', p.nationality);
    row = row.replace(/https:\/\/www\.transfermarkt\.com\/doru-andrei\/profil\/spieler\/806193/g, 'https://www.transfermarkt.com/victor-daguin/profil/spieler/418654');
    row = row.replace(/Doru Andrei/g, p.name).replace(/Romania(?=<\/strong>)/g, 'France');
    row = setAttr(row, 'data-peak', '0');
    row = setAttr(row, 'data-current-mv', '');
    row = row.replace(/(<td[^>]*data-label="(?:Jelenlegi MV|All-time Peak MV|Peak MV klub)"[^>]*>)[\s\S]*?<\/td>/g, '$1</td>');
    if (file.startsWith('Romanian')) row = row.replace(/data-type="romanian"/, 'data-type="legionary"').replace(/román játékos/g, 'légiós');
  }
  for (const [key, value] of Object.entries({ 'data-club':club, 'data-seen-club':club, 'data-seen-team':club, 'data-competition':m.competition, 'data-season':m.season, 'data-round':m.round, 'data-date':m.date, 'data-year':m.date.slice(0,4), 'data-match-id':m.id, 'data-h2h-home':m.home, 'data-h2h-away':m.away, 'data-seen-mv':'' })) if (row.includes(`${key}="`)) row = setAttr(row, key, value);
  if (!row.includes('data-match-id="')) row = row.replace(/^<tr\b/, `<tr data-match-id="${esc(m.id)}"`);
  row = row.replace(/(<td[^>]*data-label="(?:Látott csapat|Látáskori román csapat|Látáskori klub)"[^>]*>[\s\S]*?<strong>)[^<]*(<\/strong>)/, (_, x, y) => x + esc(club) + y);
  row = row.replace(/(<td[^>]*data-label="(?:Látáskori MV|Látáskor MV)"[^>]*>)[\s\S]*?<\/td>/, '$1</td>');
  const matchCell = `<td class="match-cell" data-label="Látott meccs / eredmény"><a href="${esc(m.sourceUrl)}" target="_blank" rel="noopener"><strong>${esc(m.homeName)} - ${esc(m.awayName)}</strong></a><span class="score">${m.goalsHome}:${m.goalsAway}</span><span>${m.date}</span></td>`;
  assert.match(row, /<td[^>]*data-label="Látott meccs \/ eredmény"/);
  row = row.replace(/<td[^>]*data-label="Látott meccs \/ eredmény"[^>]*>[\s\S]*?<\/td>/, matchCell);
  const search = `${p.id} ${p.name} ${p.nationality} ${club} ${m.competition} ${m.season} ${m.round} ${m.date} ${m.homeName} ${m.awayName}`.toLocaleLowerCase('hu');
  row = setAttr(row, 'data-search', search);
  return row;
}
for (const file of files) {
  const target = path.join(root, file), html = fs.readFileSync(target, 'utf8');
  const tbody = html.match(/(<tbody[^>]*>)([\s\S]*?)(<\/tbody>)/);
  assert.ok(tbody, `Hiányzó tábla: ${file}`);
  const rows = [...tbody[2].matchAll(/<tr\b[^>]*data-player-id="\d+"[^>]*>[\s\S]*?<\/tr>/g)].map(m => m[0]);
  let inserted = 0;
  for (const a of records) {
    const m = fixtures.get(a.match);
    if (rows.some(row => rowId(row) === a.player && (attr(row, 'data-match-id') === a.match || row.includes(`data-match-id="${a.match}"`)))) continue;
    let templates = rows.filter(row => rowId(row) === a.player);
    if (file.startsWith('Euro-')) templates = [...new Map(templates.map(row => [attr(row, 'data-tournament'), row])).values()];
    else templates = templates.slice(0, 1);
    if (!templates.length && a.player === '418654' && (file.startsWith('Romanian') || file.startsWith('All Players'))) templates = [rows.find(row => rowId(row) === '806193')];
    for (const template of templates) {
      const cloned = clone(template, a, file);
      const matching = rows.map((row,i) => [row,i]).filter(([row]) => rowId(row) === a.player);
      const later = matching.find(([row]) => attr(row, 'data-date') > m.date);
      const at = later?.[1] ?? (matching.length ? matching.at(-1)[1] + 1 : rows.length);
      rows.splice(at, 0, cloned); inserted++;
    }
  }
  // Player-level counters on old and newly added rows must stay synchronized.
  const additions = new Map(records.map(a => [a.player, data.appearances.filter(x => x.player === a.player).length]));
  const teams = new Map(records.map(a => [a.player, new Set(data.appearances.filter(x => x.player === a.player).map(x => x.team)).size]));
  for (let i = 0; i < rows.length; i++) {
    const id = rowId(rows[i]); if (!additions.has(id)) continue;
    rows[i] = setAttr(rows[i], 'data-appearance-count', additions.get(id));
    rows[i] = setAttr(rows[i], 'data-team-count', teams.get(id));
    if (file.startsWith('All Players')) rows[i] = rows[i].replace(/\d+ látott meccs/g, `${additions.get(id)} látott meccs`).replace(/\d+ látott csapat/g, `${teams.get(id)} látott csapat`);
    if (file.startsWith('Romanian')) rows[i] = rows[i].replace(/\d+ különböző látott klub/g, `${teams.get(id)} különböző látott klub`);
  }
  writeGenerated(target, html.replace(tbody[0], tbody[1] + '\n' + rows.join('\n') + '\n' + tbody[3]));
  console.log(`${file}: +${inserted} sor`);
}
const order = new Map(data.matches.map((m,i) => [m.id,i]));
data.appearances.sort((a,b) => order.get(a.match) - order.get(b.match) || Number(a.player) - Number(b.player));
data.players.sort((a,b) => Number(a.id) - Number(b.id));
fs.writeFileSync(dataFile, JSON.stringify(data, null, 2) + '\n');
console.log(`Ellenőrzött új pályára lépések: ${records.length}`);
