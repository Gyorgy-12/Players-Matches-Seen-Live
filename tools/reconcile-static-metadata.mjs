import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeFilterOptionOrder } from './normalize-filter-options.mjs';

const root = path.resolve(import.meta.dirname, '..');
const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&#0*39;|&#x27;/gi, "'").replace(/&quot;/g, '"');
const esc = s => decode(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const attr = (s, k) => decode(s.match(new RegExp(`\\b${k}="([^"]*)"`))?.[1] || '');
const playerRows = h => [...h.matchAll(/<tr\b[^>]*data-player-id="\d+"[^>]*>[\s\S]*?<\/tr>/g)].map(m => m[0]);
const distinct = (rows, key) => new Set(rows.map(r => attr(r, key)).filter(Boolean));
const setStat = (html, id, value) => html.replace(new RegExp(`(<strong id="${id}">)[^<]*(<\\/strong>)`), (_, a, b) => a + value + b);
const cell = (row, name) => row.match(new RegExp(`<td[^>]*data-label="${name}"[^>]*>([\\s\\S]*?)<\\/td>`))?.[1] || '';
function options(html, id, values) {
  return html.replace(new RegExp(`(<select[^>]*id="${id}"[^>]*>)([\\s\\S]*?)(<\\/select>)`), (_, a, body, b) => {
    const first = body.match(/<option\b[^>]*>[\s\S]*?<\/option>/)?.[0] || '<option value="">Összes</option>';
    return a + first + [...values].map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('') + b;
  });
}
export function reconcileMetadata() {
  const files = { matches: 'All Seen Matches.html', top5: 'TOP 5 players Seen Live.html', capped: 'Capped Players Seen Live.html', tournaments: 'Euro-WC Players Seen Live.html', romanian: 'Romanian Club-National Players Seen Live.html' };
  const counts = {};
  for (const [mode, file] of Object.entries(files)) {
    let html = fs.readFileSync(path.join(root, file), 'utf8');
    const rows = mode === 'matches' ? [...html.matchAll(/<tr\b[^>]*data-home-club-id="\d+"[^>]*>[\s\S]*?<\/tr>/g)].map(m => m[0]) : playerRows(html);
    const players = distinct(rows, 'data-player-id').size;
    counts[mode] = rows.length;
    html = html.replace(/(data-page-status>)[\s\S]*?(<\/div>)/g, (_, a, b) => `${a}1–${Math.min(50, rows.length)} / ${rows.length} sor${b}`)
      .replace(/(data-page-total>)\d+(<\/span>)/g, (_, a, b) => a + Math.max(1, Math.ceil(rows.length / 50)) + b);
    if (mode === 'matches') {
      const stats = { 'Mérkőzések': rows.length, 'Nézőszám ismert': rows.filter(r => attr(r, 'data-attendance-known') === '1').length, 'Mindkét akkori MV ismert': rows.filter(r => /€/.test(cell(r, 'Hazai akkori MV')) && /€/.test(cell(r, 'Vendég akkori MV'))).length, 'Stadionországok': distinct(rows, 'data-country').size };
      for (const [label, n] of Object.entries(stats)) html = html.replace(new RegExp(`(<span>${label}<\\/span><strong[^>]*>)\\d+(<\\/strong>)`), (_, a, b) => a + n + b);
    } else if (mode === 'top5' || mode === 'capped') {
      html = setStat(setStat(html, 'stat-players', players), 'stat-rows', rows.length);
      html = html.replace(/(<div class="filter-summary" id="filter-summary">)[\s\S]*?(<\/div>)/, (_, a, b) => `${a}${players} játékos · ${rows.length} meccssor${b}`);
      for (const [id, key] of [['filter-season', 'data-season'], ['filter-seen-club', 'data-seen-club'], ['filter-nationality', 'data-nationality'], ['filter-competition', 'data-competition']]) html = options(html, id, distinct(rows, key));
    } else if (mode === 'romanian') {
      for (const [id, n] of Object.entries({ statPlayers: players, statRows: rows.length, statClubs: distinct(rows, 'data-club').size, statCompetitions: distinct(rows, 'data-competition').size })) html = setStat(html, id, n);
      for (const key of ['nationality', 'club', 'competition', 'season', 'round']) html = options(html, key, distinct(rows, `data-${key}`));
    } else {
      const previous = html.match(/const STATS = (\{[^\n]+\});/);
      if (!previous) throw new Error('Hiányzó tornaszámlálók');
      const stats = JSON.parse(previous[1]);
      for (const [key, stat] of Object.entries(stats)) {
        const selected = key === 'all' ? rows : rows.filter(r => attr(r, 'data-tournament') === key);
        stat.rows = selected.length;
        stat.uniquePlayers = distinct(selected, 'data-player-id').size;
        stat.uniqueMemberships = new Set(selected.map(r => `${attr(r, 'data-player-id')}|${attr(r, 'data-tournament')}`)).size;
        stat.coverage = key === 'all' ? null : (100 * stat.uniquePlayers / stat.officialRosterTotal).toFixed(2);
      }
      html = html.replace(previous[0], `const STATS = ${JSON.stringify(stats)};`);
      for (const [i, n] of [stats.all.uniquePlayers, stats.all.uniqueMemberships, rows.length, Object.keys(stats).length - 1].entries()) html = setStat(html, `stat-value-${i + 1}`, n);
      for (const [id, key] of [['season-filter', 'data-season'], ['club-filter', 'data-seen-club'], ['nationality-filter', 'data-nationality']]) html = options(html, id, distinct(rows, key));
    }
    fs.writeFileSync(path.join(root, file), normalizeFilterOptionOrder(html));
  }
  for (const hubFile of ['index.html', 'TM Groundhopping Hub.html']) {
    let html = fs.readFileSync(path.join(root, hubFile), 'utf8');
    html = html.replace(/(<div class="summary-card"><span>Táblázatsor<\/span><strong>)[\d\s]+(<\/strong>)/, (_, a, b) => a + Object.values(counts).reduce((n, c) => n + c, 0).toLocaleString('hu-HU', { useGrouping: 'always' }) + b);
    for (const [mode, n] of Object.entries(counts)) html = html.replace(new RegExp(`(id:'${mode}'[\\s\\S]*?meta:')[\\d\\s]+ (sor|mérkőzés)'`), (_, a, unit) => a + n.toLocaleString('hu-HU', { useGrouping: 'always' }) + ' ' + unit + "'");
    fs.writeFileSync(path.join(root, hubFile), html);
  }
  return counts;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(reconcileMetadata());
