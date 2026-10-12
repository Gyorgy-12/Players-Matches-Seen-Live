import fs from 'node:fs';
import path from 'node:path';
import '../tmgh-statistics-core.js';
import { reconcileMetadata } from './reconcile-static-metadata.mjs';
import { normalizeFilterOptionOrder } from './normalize-filter-options.mjs';

const root = path.resolve(import.meta.dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'seen-statistics.json'), 'utf8'));
const { aggregate, compareNames } = globalThis.TMGHStatistics;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const json = data => JSON.stringify(data).replace(/</g, '\\u003c');
const option = (v, label = v) => `<option value="${esc(v)}">${esc(label)}</option>`;
const select = (id, label, items) => `<div class="filter-field"><label for="${id}">${label}</label><select id="${id}" name="${id}">${items.map(([v, l]) => option(v, l)).join('')}</select></div>`;
const seasons = [...new Set(data.matches.map(m => m.season))].sort((a, b) => b.localeCompare(a, 'hu', { numeric: true }));
const competitions = [...new Set(data.matches.map(m => m.competition))].sort(compareNames);
const teams = Object.entries(data.teams).sort((a, b) => compareNames(a[1], b[1]));
const games = [...data.matches].sort((a, b) => b.date.localeCompare(a.date)).map(m => [m.id, `${m.date} · ${m.homeName} – ${m.awayName} ${m.goalsHome}:${m.goalsAway}`]);
const configs = {
  players: { title: 'Játékosstatisztikák', file: 'Player Statistics.html', entity: 'játékos', kicker: 'Látott játékosok · statisztikák',
    columns: [['name', 'Játékos'], ['teams', 'Látott csapatok'], ['apps', 'Látott meccsek'], ['goals', 'Gól'], ['assists', 'Gólpassz'], ['yellow', 'Sárga lap'], ['red', 'Kiállítás'], ['penaltyGoals', '11-es gól'], ['penalties', 'Elvégzett 11-es'], ['penaltiesWon', 'Kiharcolt 11-es'], ['minutes', 'Játékperc']] },
  teams: { title: 'Csapatstatisztikák', file: 'Team Statistics.html', entity: 'csapat', kicker: 'Látott csapatok · statisztikák',
    sortOnly: ['penaltyMisses', 'penaltyMissesAgainst'],
    columns: [['name', 'Csapat'], ['apps', 'Látott meccsek'], ['goals', 'Lőtt gól'], ['goalsAgainst', 'Kapott gól'], ['difference', 'Gólkülönbség'], ['yellow', 'Sárga lap'], ['red', 'Kiállítás'], ['awarded', 'Javára ítélt 11-es'], ['penaltyGoals', 'Értékesített 11-es'], ['penaltyMisses', 'Kihagyott 11-es'], ['penaltiesAgainst', 'Ellene ítélt 11-es'], ['penaltyGoalsAgainst', 'Kapott 11-es gól'], ['penaltyMissesAgainst', 'Ellenfél kihagyott 11-ese'], ['wins', 'Győzelem'], ['draws', 'Döntetlen'], ['losses', 'Vereség']] },
};
const pagination = (bottom = false) => `<div class="tmgh-pagination tmgh-pagination-${bottom ? 'bottom' : 'top'}" data-tmgh-pager aria-label="Táblázat lapozása"><div class="tmgh-page-status" data-page-status aria-live="polite"></div><div class="tmgh-pagination-controls"><button type="button" data-page-action="prev" aria-label="Előző oldal">‹ Előző</button><span class="tmgh-page-number">Oldal <strong data-page-current>1</strong> / <span data-page-total>1</span></span><button type="button" data-page-action="next" aria-label="Következő oldal">Következő ›</button></div><label class="tmgh-page-size" for="page-size${bottom ? '-bottom' : ''}">Sor/oldal <select id="page-size${bottom ? '-bottom' : ''}" data-page-size><option value="50" selected>50</option><option value="100">100</option><option value="200">200</option></select></label></div>`;
const counts = {};
for (const [mode, config] of Object.entries(configs)) {
  // Keep the same logical order in sorting, without rendering sort-only metrics.
  const columns = config.columns.filter(([key]) => !config.sortOnly?.includes(key));
  const result = aggregate(data, mode);
  counts[mode] = result.length;
  const goals = mode === 'players' ? result.reduce((n, r) => n + r.goals, 0) : data.matches.reduce((n, m) => n + m.goalsHome + m.goalsAway, 0);
  const partialMatches = data.coverage.filter(c => !c.complete);
  const completeness = `${data.matches.length - partialMatches.length} / ${data.matches.length}`;
  const initialRows = result.slice(0, 50).map((r, i) => `<tr data-stat-id="${r.id}">${columns.map(([k, label]) => `<td data-label="${label}" data-metric="${k}">${k === 'name' ? `<strong>${esc(r.name)}</strong><span class="rank">#${i + 1}</span>` : k === 'teams' ? `<span class="stat-teams">${esc(r.teams.join(' · '))}</span>` : `<strong class="${k === 'goals' ? 'selected-metric' : ''}">${r[k].toLocaleString('hu-HU')}</strong>`}</td>`).join('')}</tr>`).join('\n');
  const html = `<!doctype html>
<html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${config.title} · TM Groundhopping</title>
<link rel="stylesheet" href="tmgh-unified.css"><link rel="stylesheet" href="tmgh-statistics.css">
<script src="tmgh-statistics-core.js" defer></script><script src="tmgh-statistics.js" defer></script><script src="tmgh-unified.js" defer></script></head>
<body data-tmgh-mode="${mode}-statistics" data-statistics-mode="${mode}" data-runtime-fetch="false" data-static-export="${data.asOf}" data-stat-count="${result.length}">
<main class="page"><section class="hero" data-kicker="${config.kicker}"><h1>${config.title}</h1><p class="muted">Csak azok a mérkőzések számítanak, amelyeken ott voltál. A szűrők az összesítést is újraszámolják.${mode === 'players' ? ' A kiválasztott statisztikában nullán állók nem jelennek meg.' : ''}</p><div class="stats">
${[[mode === 'players' ? 'Látott gólszerzők' : 'Látott csapatok', result.length], ['Látott mérkőzések', data.matches.length], [mode === 'players' ? 'Játékosok góljai' : 'Gólok a meccseken', goals], ['Teljes eseményadat', completeness]].map(([label, n]) => `<div class="stat"><span>${label}</span><strong>${n}</strong></div>`).join('')}
</div></section>
<section class="filter-card"><div class="filter-title">Szűrők és rendezés</div><div class="filter-body"><form id="statistics-filters"><div class="filter-grid">
<div class="filter-field"><label for="query">${mode === 'players' ? 'Játékos neve' : 'Csapat keresése'}</label><input type="search" id="query" name="query" placeholder="${mode === 'players' ? 'pl. Oscar Siafa' : 'pl. U Cluj'}" autocomplete="off"></div>
${select('season', 'Szezon', [['', 'Minden szezon'], ...seasons.map(s => [s, s])])}
${select('team', 'Látott csapat', [['', 'Minden látott csapat'], ...teams])}
${select('competition', 'Verseny', [['', 'Minden verseny'], ...competitions.map(s => [s, s])])}
${select('match', 'Mérkőzés', [['', 'Minden látott mérkőzés'], ...games])}
${select('sort', 'Rendezési szempont', [['goals', mode === 'players' ? 'Gól' : 'Lőtt gól'], ...config.columns.filter(([k]) => !['name', 'teams', 'goals'].includes(k))])}
${select('direction', 'Rendezési irány', [['desc', 'Csökkenő ↓'], ['asc', 'Növekvő ↑']])}
<div class="filter-field"><label for="minApps">Minimum látott meccs</label><input type="number" id="minApps" name="minApps" min="1" step="1" value="1" inputmode="numeric"></div>
<button type="button" id="reset">Szűrők törlése</button></div></form>
<div class="filter-summary" id="filter-summary" aria-live="polite">${result.length} ${config.entity}</div>
<details class="statistics-note"><summary>Mit számolunk bele?</summary>
<p>${mode === 'players' ? 'Csak a kiválasztott statisztikában pozitív értékű játékosok jelennek meg, az aktuális szűrés alapján. Gólrendezésnél a gólszerzők, gólpassznál az asszisztot adók, lapoknál a lapot kapók; növekvő rendezésnél sincsenek nullás sorok. Egy játékos egy meccsen egyszer számít, attól függetlenül, hogy hány másik fülön szerepel. Csapatszűréskor csak az adott csapat színeiben látott szereplései számítanak.' : 'Mindkét résztvevő csapat saját eredményével szerepel. A kapott gól és a győzelem–döntetlen–vereség mutató mindig a csapat szemszögéből értendő. A játékosok cserepadon kapott lapjai is beleszámítanak, az edzői/stáblapok nem.'}</p>
<p>A gólok és a büntetők a rendes játékidőt és a hosszabbítást fedik le; a tizenegyespárbajok nem számítanak bele. A sárgák között a második sárga is szerepel, a kiállítás egyenes pirosat és második sárgás kiállítást is jelent. A gólpasszok a Transfermarkt jóváírásait követik.</p>
<p>${mode === 'teams' ? 'Javára ítélt 11-es: a rögzített elvégzések, értékesítések és játékoshoz rendelt kiharcolások közül a legnagyobb darabszám meccsenként; egy büntető csak egyszer számít. Mellette az értékesített büntetők szerepelnek. Ellene ítélt 11-es: az ellenfél javára ítélt büntetők; a kapott 11-es gól az ezekből szerzett gólokat mutatja. A saját és az ellenfél kihagyott büntetői csak rendezési szempontként választhatók. Kihagyás csak ismert elvégzésből és ismert gólértékből számolható, hiányzó eredményt nem tekintünk kihagyásnak. A védett büntető is kihagyás, de a kipattanóból szerzett gól már nem 11-es gól. A VAR által visszavont büntetők nem számítanak.' : 'Kiharcolt 11-es: csak a Transfermarkt által játékoshoz rendelt esetek. Az értékesített büntető a gólösszegben is benne van.'}</p>
<p>Forrás: Transfermarkt meccslapok és játékosonkénti meccsstatisztikák. Adatállapot: ${data.asOf}. A * hiányos forrásadat miatti részösszeg, nem igazolt nulla. ${partialMatches.map(c => { const m = data.matches.find(m => m.id === c.match); return `<a href="https://www.transfermarkt.com/spielbericht/index/spielbericht/${m.id}" target="_blank" rel="noopener">${esc(m.homeName)} – ${esc(m.awayName)} (${m.date})</a>`; }).join('; ')}.</p>
</details></div></section>
<section class="table-card" id="statistics-table"><div class="table-title">${mode === 'players' ? 'Látott játékosok rangsora' : 'Látott csapatok rangsora'}</div>
<div class="partial-note" id="partial-note"${partialMatches.length ? '' : ' hidden'}>* Egyes korábbi meccsek eseményadatai hiányosak. A jelölt értékek a biztosan rögzített részösszegek.</div>
${pagination()}<div class="table-wrap statistics-table-wrap" tabindex="0" role="region" aria-label="${config.title}, vízszintesen görgethető táblázat"><table class="statistics-table"><thead><tr>${columns.map(([, label]) => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody id="statistics-rows">${initialRows}</tbody></table></div>
<div class="empty" id="empty" hidden>Nincs a szűrésnek megfelelő ${config.entity}.</div>${pagination(true)}</section>
<noscript>A szűréshez és lapozáshoz engedélyezd a JavaScriptet. Minden adat előre be van ágyazva, internetes adatlekérés nincs.</noscript></main>
<script type="application/json" id="statistics-data">${json(data)}</script><script type="application/json" id="statistics-columns">${json(columns)}</script></body></html>`;
  fs.writeFileSync(path.join(root, config.file), normalizeFilterOptionOrder(html));
}
let hub = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
hub = hub.replace('Az öt statikus HTML', 'A hét statikus HTML').replace(/(<span>Oldalak<\/span><strong>)\d+(<\/strong>)/, '$17$2');
hub = hub.replace(/description:'\d+ mérkőzés összehasonlító táblázata'/, `description:'${data.matches.length} mérkőzés összehasonlító táblázata'`);
if (!hub.includes("id:'playerstats'")) hub = hub.replace(/(file:'Romanian Club-National Players Seen Live.html' \})/, `$1,
        { id:'playerstats', icon:'J', title:'Játékosstatisztikák', description:'Gólok, gólpasszok, lapok és látott pályára lépések', meta:'${counts.players} játékos', file:'Player Statistics.html' },
        { id:'teamstats', icon:'CS', title:'Csapatstatisztikák', description:'Lőtt és kapott gólok, lapok és büntetők', meta:'${counts.teams} csapat', file:'Team Statistics.html' }`);
hub = hub.replace("new Set(['capped', 'romanian'])", "new Set(['capped', 'romanian', 'playerstats', 'teamstats'])");
for (const f of ['index.html', 'TM Groundhopping Hub.html']) fs.writeFileSync(path.join(root, f), hub);
reconcileMetadata();
console.log('Új statikus fülek:', counts);
