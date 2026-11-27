import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { writeGenerated } from './write-generated.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fixtures = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'verified-off-transfermarkt-fixtures.json'), 'utf8'));
const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (row, key) => row.match(new RegExp(`\\b${key}="([^"]*)"`))?.[1] || '';
const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('hu').replace(/[^a-z0-9]+/g, ' ').trim();
const score = m => `${m.goalsHome}:${m.goalsAway}`;
const cell = (label, body) => `<td data-label="${esc(label)}">${body}</td>`;
function render(m) {
  const goals = m.goals ? `<span class="tmgh-fixture-detail">Gólszerzők: ${esc(m.goals)}${m.scorers?.length ? ` · ${m.scorers.map(p => `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)} a Transfermarkton</a>`).join(', ')}` : ''}</span>` : '';
  const title = `<a href="${esc(m.sourceUrl)}" target="_blank" rel="noopener"><strong>${esc(m.homeName)} - ${esc(m.awayName)}</strong></a><span class="score">${score(m)}</span><span>${m.date}</span>${goals}`;
  const place = m.stadium ? `<strong>${esc(m.stadium)}</strong><span>${esc(m.city)} · ${esc(m.country)}</span>` : `<span>${esc(m.city)} · ${esc(m.country)}; stadion nem igazolt</span>`;
  return `<tr data-match-id="${esc(m.id)}" data-source-url="${esc(m.sourceUrl)}" data-attendance="-1" data-attendance-known="0" data-away-team="${esc(norm(m.awayName))}" data-competition="${esc(m.competition)}" data-country="romania" data-date="${Date.parse(m.date + 'T00:00:00Z')}" data-goals="${m.goalsHome + m.goalsAway}" data-goal-difference="${Math.abs(m.goalsHome - m.goalsAway)}" data-home-team="${esc(norm(m.homeName))}" data-location="domestic" data-season="${esc(m.season)}" data-sheet-total="0" data-stadium="${esc(norm(m.stadium || ''))}" data-strongest-historical="0" data-teams="${esc(norm(m.homeName))}" data-home-club-id="${esc(m.home)}" data-away-club-id="${esc(m.away)}" data-h2h-home="${esc(m.home)}" data-h2h-away="${esc(m.away)}">
${cell('Mérkőzés / eredmény', title)}
${cell('Nézőszám', '')}${cell('Meccsnapi összérték', '')}
${cell('Hazai akkori MV', '')}${cell('Hazai jelenlegi MV', '')}
${cell('Vendég akkori MV', '')}${cell('Vendég jelenlegi MV', '')}
${cell('Verseny', `<strong>${esc(m.competition)}</strong>`)}${cell('Szezon', `<strong>${esc(m.season)}</strong>`)}
${cell('Forduló / fázis / meccsnap', `<strong>${esc(m.round)}</strong>`)}
${cell('Stadion / város / ország', place)}</tr>`;
}
function addOptions(html, id, values) {
  return html.replace(new RegExp(`(<select id="${id}">)([\\s\\S]*?)(<\\/select>)`), (_, open, body, close) => {
    for (const value of values) if (!body.includes(`>${esc(value)}</option>`)) body += `<option value="${esc(id === 'team' || id === 'stadium' ? norm(value) : value)}">${esc(value)}</option>`;
    return open + body + close;
  });
}
const matchPath = path.join(root, 'All Seen Matches.html');
let html = fs.readFileSync(matchPath, 'utf8');
const table = html.match(/(<tbody id="rows">)([\s\S]*?)(<\/tbody>)/);
assert.ok(table);
let rows = [...table[2].matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map(m => m[0]);
for (const m of fixtures) {
  const index = rows.findIndex(r => attr(r, 'data-match-id') === m.id);
  if (index < 0) rows.push(render(m));
  else rows[index] = render(m);
}
rows.sort((a, b) => Number(attr(b, 'data-date')) - Number(attr(a, 'data-date')));
assert.equal(new Set(rows.map(r => attr(r, 'data-match-id') || r.match(/spielbericht\/(\d+)/)?.[1])).size, rows.length);
html = html.replace(table[0], table[1] + '\n' + rows.join('\n') + '\n' + table[3]);
for (const [id, values] of [
  ['team', fixtures.map(m => m.homeName)], ['stadium', fixtures.map(m => m.stadium).filter(Boolean)],
  ['season', fixtures.map(m => m.season)], ['competition', fixtures.map(m => m.competition)]
]) html = addOptions(html, id, [...new Set(values)]);
html = html.replace(/egységes statikus export: 2026-11-11\./, 'korábbi játékosadatok: 2026-11-11 · új meccsek: 2026-11-27.');

const dataPath = path.join(import.meta.dirname, 'seen-statistics.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
for (const m of fixtures) {
  if (!data.matches.some(old => old.id === m.id)) data.matches.push(Object.fromEntries(['id', 'date', 'season', 'competition', 'home', 'away', 'homeName', 'awayName', 'goalsHome', 'goalsAway', 'sourceUrl'].map(key => [key, m[key]])));
  data.teams[m.home] = m.homeName; data.teams[m.away] = m.awayName;
  if (!data.coverage.some(c => c.match === m.id)) data.coverage.push({ match: m.id, players: 0, unknown: 0, homeGoals: 0, awayGoals: 0, expected: [m.goalsHome, m.goalsAway], complete: false });
}
data.matches.sort((a, b) => b.date.localeCompare(a.date));
data.coverage.sort((a, b) => data.matches.findIndex(m => m.id === a.match) - data.matches.findIndex(m => m.id === b.match));
data.matchInventoryAsOf = '2026-11-27';
fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n');
writeGenerated(matchPath, html);
console.log(`Igazolt mérkőzések: ${fixtures.length}; összesen ${rows.length}.`);
