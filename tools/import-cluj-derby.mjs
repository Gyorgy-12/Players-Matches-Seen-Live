import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { normalizeFilterOptionOrder } from './normalize-filter-options.mjs';

const root = path.resolve(import.meta.dirname, '..');
const match = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'match-4914561.json'), 'utf8'));
const files = ['All Seen Matches.html', 'TOP 5 players Seen Live.html', 'Capped Players Seen Live.html', 'Euro-WC Players Seen Live.html', 'Romanian Club-National Players Seen Live.html'];
const htmls = new Map(files.map(f => [f, fs.readFileSync(path.join(root, f), 'utf8')]));
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const attr = (r, k) => r.match(new RegExp(`\\b${k}="([^"]*)"`))?.[1] || '';
const rows = h => [...h.matchAll(/<tr\b[^>]*data-player-id="\d+"[^>]*>[\s\S]*?<\/tr>/g)].map(m => m[0]);
const setAttr = (r, k, v) => r.replace(/^<tr\b[^>]*>/, o => new RegExp(`\\b${k}="[^"]*"`).test(o) ? o.replace(new RegExp(`\\b${k}="[^"]*"`), `${k}="${esc(v)}"`) : o.replace(/>$/, ` ${k}="${esc(v)}">`));
const setCell = (r, label, html) => r.replace(new RegExp(`(<td\\b[^>]*data-label="${rx(label)}"[^>]*>)[\\s\\S]*?(<\\/td>)`), (_, a, b) => a + html + b);
const money = n => !n ? '—' : n >= 1e6 ? `€${(n / 1e6).toFixed(2)}m` : `€${Math.round(n / 1000)}k`;
const value = (n, date = '') => `<span class="value">${money(n)}</span>${date ? `<span>snapshot: ${esc(date)}</span>` : ''}`;
const cell = (label, inner, cls = '') => `<td${cls ? ` class="${cls}"` : ''} data-label="${esc(label)}">${inner}</td>`;
const strong = s => `<strong>${esc(s)}</strong>`;
const displayDate = s => s ? s.slice(0, 10).split('-').reverse().join('/') : '';
const title = 'CFR Cluj - U Cluj';
const url = match.sources.sheetUrl;
const matchInner = `<a href="${url}" target="_blank" rel="noopener">${title}</a><span class="score">1:3</span><span>${match.date}</span>`;
const nationalityToken = name => name === 'The Gambia' ? 'gambia' : name.toLowerCase();
function makePlayerRow(p, mode) {
  const old = rows(htmls.get(files[4])).find(r => attr(r, 'data-player-id') === p.id);
  // Keep established display names and primary nationality consistent across modes.
  const name = old?.match(/<strong>([^<]+)<\/strong>/)?.[1] || p.name;
  const nationality = old ? attr(old, 'data-nationality') : p.nationality;
  const current = p.profile.marketValueDetails.current;
  const peak = p.profile.marketValueDetails.highest;
  const points = p.graph.filter(g => Number(g.y) === Number(peak.value)).sort((a, b) => Number(a.x) - Number(b.x));
  const peakPoint = points[0];
  const peakDate = peakPoint?.datum_mw || displayDate(peak.determined);
  const top = mode === 'top5'; const ro = mode === 'romanian';
  const total = top ? Object.values(p.top5).reduce((n, s) => n + s.apps, 0) : p.senior.reduce((n, s) => n + Number(s.gamesPlayed), 0);
  const searchName = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const attrs = { 'data-player-id': p.id, 'data-player': ro ? name : searchName, 'data-season': match.season, 'data-nationality': nationality, 'data-competition': match.competition, 'data-round': match.round, 'data-status': 'active', 'data-current-mv': current.value || 0, 'data-peak': peak.value || 0, 'data-date': match.date, 'data-year': '2026' };
  const teamSet = new Set(rows(htmls.get(files[4])).filter(r => attr(r, 'data-player-id') === p.id).map(r => attr(r, 'data-club')));
  teamSet.add(p.club);
  if (ro) Object.assign(attrs, { 'data-club': p.club, 'data-type': nationality === 'Romania' ? 'romanian' : 'legionnaire', 'data-team-count': teamSet.size, 'data-seen-mv': p.atMatch?.y || 0 });
  else Object.assign(attrs, { 'data-seen-club': p.club, 'data-club-at-match': p.club, 'data-total-apps': total }, top ? { 'data-leagues': `|${Object.keys(p.top5).join('|')}|` } : { 'data-nationality-tokens': `|${nationality}|`, 'data-national-teams': `|${p.senior.map(n => `name:${nationalityToken(n.name)}`).join('|')}|` });
  const cells = [
    cell('Játékos', `<a href="${p.url}" target="_blank" rel="noopener">${strong(name)}</a><span>${ro ? `${teamSet.size} különböző látott klub · ` : ''}ID: ${p.id}</span>`, 'player-cell'),
    cell('Nemzetiség', strong(nationality) + (ro ? `<span>${nationality === 'Romania' ? 'román' : 'légiós'}</span>` : '')),
  ];
  if (ro) cells.push(cell('Látáskori román csapat', strong(p.club)));
  else {
    cells.push(cell(top ? 'Top-5 liga/app' : 'Válogatott / meccs / gól', top ? Object.entries(p.top5).map(([id, s]) => `<span class="badge league-${id}">${s.name} · ${s.apps} / ${s.minutes}p</span>`).join(' ') : p.senior.map(n => `<span class="badge">${esc(n.name)} · ${n.gamesPlayed} meccs · ${n.goalsScored} gól</span>`).join(' ')));
    cells.push(cell('Látott csapat', strong(p.club)), cell('Látáskori klub', strong(p.club)));
  }
  cells.push(cell('Látáskori MV', value(p.atMatch?.y, p.atMatch?.datum_mw)), cell('Mostani klub / státusz', strong(p.currentClub)), cell('Jelenlegi MV', value(current.value, displayDate(current.determined))), cell('All-time Peak MV', value(peak.value, peakDate)), cell('Peak MV klub', strong(peakPoint?.verein || '')), cell('Látott meccs / eredmény', matchInner, 'match-cell'), cell('Verseny', strong(match.competition)), cell('Szezon', strong(match.season)), cell('Forduló / fázis / meccsnap', strong(match.round)));
  return `<tr ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}>\n${cells.join('\n')}\n</tr>`;
}
const additions = new Map(files.slice(1).map(f => [f, []]));
for (const p of match.roster.filter(p => p.played)) {
  additions.get(files[4]).push(makePlayerRow(p, 'romanian'));
  if (Object.keys(p.top5).length) additions.get(files[1]).push(makePlayerRow(p, 'top5'));
  if (p.senior.length) additions.get(files[2]).push(makePlayerRow(p, 'capped'));
  const memberships = new Map(rows(htmls.get(files[3])).filter(r => attr(r, 'data-player-id') === p.id).map(r => [attr(r, 'data-tournament'), r]));
  for (let row of memberships.values()) {
    for (const [k, v] of Object.entries({ 'data-season': match.season, 'data-seen-club': p.club, 'data-date': match.date })) row = setAttr(row, k, v);
    for (const [label, content] of [['Látáskor klub', strong(p.club)], ['Látáskor MV', value(p.atMatch?.y, p.atMatch?.datum_mw)], ['Látott meccs / eredmény', matchInner], ['Verseny', strong(match.competition)], ['Szezon', strong(match.season)], ['Forduló / fázis', strong(match.round)]]) row = setCell(row, label, content);
    additions.get(files[3]).push(row);
  }
}
// The six userscript roster sources were checked: only Chipciu (EURO 2016)
// and Lukic (WC 2026) are members among this match's actual participants.
assert.equal(additions.get(files[3]).length, 2);
for (const [file, added] of additions) {
  let html = htmls.get(file);
  // Idempotent re-import: replace only this match, never other appearances.
  html = html.replace(/<tr\b[^>]*data-player-id="\d+"[^>]*>[\s\S]*?<\/tr>/g, row => row.includes(`spielbericht/${match.gameId}`) ? '' : row);
  html = html.replace('</tbody>', `${added.join('\n')}\n</tbody>`);
  if (file === files[4]) {
    const teams = new Map();
    for (const row of rows(html)) { const id = attr(row, 'data-player-id'); if (!teams.has(id)) teams.set(id, new Set()); teams.get(id).add(attr(row, 'data-club')); }
    html = html.replace(/<tr\b[^>]*data-player-id="\d+"[^>]*>[\s\S]*?<\/tr>/g, row => {
      const count = teams.get(attr(row, 'data-player-id')).size;
      return setAttr(row, 'data-team-count', count).replace(/\d+ különböző látott klub/, `${count} különböző látott klub`);
    });
  }
  htmls.set(file, html);
}
const total = Object.values(match.totals).reduce((n, t) => n + t.value, 0);
const attrs = { 'data-attendance': match.attendance || 0, 'data-attendance-known': match.attendance ? 1 : 0, 'data-away-team': 'u cluj', 'data-competition': match.competition, 'data-country': 'romania', 'data-date': Date.parse(match.date), 'data-goals': 4, 'data-goal-difference': 2, 'data-home-team': 'cfr cluj', 'data-location': 'domestic', 'data-season': match.season, 'data-sheet-total': total, 'data-stadium': 'dr. constantin radulescu', 'data-strongest-historical': Math.round(Math.max(...Object.values(match.historical))), 'data-teams': 'cfr cluj', 'data-home-club-id': '7769', 'data-away-club-id': '6429' };
const matchRow = `<tr ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}>
${cell('Mérkőzés / eredmény', matchInner.replace(`>${title}</a>`, `><strong>${title}</strong></a>`))}
${cell('Nézőszám', match.attendance ? strong(match.attendance) : '')}${cell('Meccsnapi összérték', value(total))}
${cell('Hazai akkori MV', value(match.historical['7769']))}${cell('Hazai jelenlegi MV', '')}
${cell('Vendég akkori MV', value(match.historical['6429']))}${cell('Vendég jelenlegi MV', '')}
${cell('Verseny', strong(match.competition))}${cell('Szezon', strong(match.season))}${cell('Forduló / fázis / meccsnap', strong(match.round))}
${cell('Stadion / város / ország', `${strong('Dr. Constantin Rădulescu')}<span>Cluj-Napoca · Romania</span>`)}</tr>`;
let all = htmls.get(files[0]).replace(/<tr\b[^>]*data-home-club-id="\d+"[^>]*>[\s\S]*?<\/tr>/g, row => row.includes(`spielbericht/${match.gameId}`) ? '' : row);
all = all.replace(/(<tbody id="rows">)/, `$1\n${matchRow}`);
htmls.set(files[0], all);
for (const [file, html] of htmls) fs.writeFileSync(path.join(root, file), normalizeFilterOptionOrder(html));
console.log('Meccs importálva:', match.gameId, 'Keretösszeg:', total, 'Új meccssorok:', Object.fromEntries([...additions].map(([f, r]) => [f, r.length])));
