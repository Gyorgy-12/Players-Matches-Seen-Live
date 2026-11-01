import fs from 'node:fs';
import path from 'node:path';
const statistics = path.join(import.meta.dirname, 'seen-statistics.json');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Embed fixture identities and controls in every standalone export. No runtime
// requests or name-based guesses: foreign opponents and national teams use IDs.
export function addH2HFilter(html) {
  if (!html.includes('class="filter-card"') || !fs.existsSync(statistics)) return html;
  const data = JSON.parse(fs.readFileSync(statistics, 'utf8'));
  const matches = new Map(data.matches.map(m => [m.id, m]));
  const games = new Set();
  html = html.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/g, row => {
    const id = row.match(/spielbericht\/(\d+)/)?.[1];
    const match = matches.get(id);
    if (!match) return row;
    games.add(id);
    return row.replace(/^<tr\b[^>]*>/, opening => opening
      .replace(/ data-h2h-(?:home|away)="[^"]*"/g, '')
      .replace(/>$/, ` data-h2h-home="${match.home}" data-h2h-away="${match.away}">`));
  });
  const relevant = html.includes('data-statistics-mode=') ? data.matches : data.matches.filter(m => games.has(m.id));
  const ids = new Set(relevant.flatMap(m => [m.home, m.away]));
  const teams = [...ids].map(id => [id, data.teams[id]]).sort((a, b) => a[1].localeCompare(b[1], 'hu', { sensitivity: 'base', numeric: true }));
  const options = '<option value="">Válassz csapatot</option>' + teams.map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
  const controls = `<!--tmgh-h2h-start--><fieldset class="tmgh-h2h"><legend>H2H · Egymás ellen</legend><div class="tmgh-h2h-grid"><div><label for="h2h-a">1. csapat</label><select id="h2h-a">${options}</select></div><div><label for="h2h-b">2. csapat</label><select id="h2h-b">${options}</select></div></div><p id="h2h-help">Válassz két csapatot. A hazai–vendég sorrend nem számít; a többi szűrő is érvényes.</p></fieldset><!--tmgh-h2h-end-->`;
  html = html.replace(/<!--tmgh-h2h-start-->[\s\S]*?<!--tmgh-h2h-end-->/g, '');
  html = html.replace(/(<section class="filter-card"[^>]*>[\s\S]*?)(<\/section>)/, (_, section, end) => section + controls + end);
  html = html.replace(/<select id="(h2h-[ab])">/g, (_, id) => `<input id="${id}-search" class="tmgh-h2h-search" type="search" placeholder="Csapatnév keresése…" aria-label="${id === 'h2h-a' ? '1.' : '2.'} csapat keresése" autocomplete="off" spellcheck="false" aria-controls="${id}"><span class="tmgh-h2h-search-status" id="${id}-search-status" aria-live="polite"></span><select id="${id}">`);
  if (!html.includes('window.TMGHH2H?.matches')) {
    if (html.includes('const filtered = all.filter((row) =>'))
      html = html.replace('const filtered = all.filter((row) =>', 'const filtered = all.filter((row) => (window.TMGHH2H?.matches(row) !== false) &&');
    else if (html.includes('for (const item of rowData)'))
      html = html.replace(/const visible =\s*\n\s*matchesPlayer &&/, 'const visible =\n            (window.TMGHH2H?.matches(item.row) !== false) && matchesPlayer &&');
    else if (html.includes('const matchesCompetition'))
      html = html.replace(/const visible =\s*\n\s*matchesPlayer &&/, 'const visible =\n            (window.TMGHH2H?.matches(row) !== false) && matchesPlayer &&');
    else if (html.includes('function matchesFilters(row) {'))
      html = html.replace('function matchesFilters(row) {', 'function matchesFilters(row) {\n      if (window.TMGHH2H?.matches(row) === false) return false;');
    else if (html.includes('const ok = (!q || searchText.includes(q))'))
      html = html.replace('const ok = (!q || searchText.includes(q))', 'const ok = (window.TMGHH2H?.matches(row) !== false) && (!q || searchText.includes(q))');
    else if (!html.includes('data-statistics-mode='))
      throw new Error('Ismeretlen exportszűrő: H2H nem kapcsolható be biztonságosan');
  }
  return html;
}
