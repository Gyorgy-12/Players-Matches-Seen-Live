import fs from 'node:fs';
import path from 'node:path';
import { normalizeFilterOptionOrder } from './normalize-filter-options.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const AS_OF = '2026-08-30';
const PLAYER_FILES = [
  'TOP 5 players Seen Live.html',
  'Capped Players Seen Live.html',
  'Euro-WC Players Seen Live.html',
  'Romanian Club-National Players Seen Live.html',
];
const TOP5_FILE = PLAYER_FILES[0];
const CAPPED_FILE = PLAYER_FILES[1];
const MATCH_FILE = 'All Seen Matches.html';
const LEAGUES = new Map([
  ['GB1', 'Premier League'],
  ['ES1', 'LaLiga'],
  ['IT1', 'Serie A'],
  ['L1', 'Bundesliga'],
  ['FR1', 'Ligue 1'],
]);
const TEAM_NAME_ALIASES = new Map([
  ['FC Universitatea Cluj', 'U Cluj'], ['Universitatea Cluj', 'U Cluj'],
  ['FC Dinamo 1948', 'FC Dinamo'],
  ['FC Rapid 1923', 'FC Rapid'], ['Rapid Bucharest', 'FC Rapid'],
  ['FCV Farul Constanta', 'FCV Farul'],
  ['Sepsi OSK Sf. Gheorghe', 'Sepsi OSK'],
  ['Universitatea Craiova', 'Univ. Craiova'],
  ['FC U Craiova 1948', 'FC U Craiova'],
  ['FK Csikszereda Miercurea Ciuc', 'FK Csikszereda'],
  ['FC Bihor 1902', 'FC Bihor'],
  ['SC Otelul Galati', 'Otelul Galati'],
  ['Petrolul Ploiesti', 'Petrolul'],
  ['CSM Slatina', 'Slatina'],
  ['Corvinul Hunedoara', 'Corvinul'],
  ['CSC Selimbar', 'CSC 1599 Selimbar'],
  ['Djurgårdens IF', 'Djurgården'],
  ['Celtic FC', 'Celtic'],
  ['FK Bodø/Glimt', 'Bodø/Glimt'],
  ['SS Lazio', 'Lazio'],
  ['US Lecce', 'Lecce'],
  ['Inter', 'Inter Milan'],
  ['Frosinone', 'Frosinone Calcio'],
  ['Steaua București', 'Steaua Bucharest'],
  ['Alashkert Yerevan FC', 'Alashkert FC'],
  ['FC Aktobe', 'Aktobe'],
  ['D. Calarasi', 'Dunarea Calarasi'],
  ['Gaz Metan Medias (- 2022)', 'Gaz Metan'], ['Gaz Metan Medias', 'Gaz Metan'],
  ['Astra Giurgiu (- 2024)', 'Astra Giurgiu'],
  ['Pandurii Targu Jiu (- 2022)', 'Pandurii Targu Jiu'], ['Pandurii Târgu Jiu', 'Pandurii Targu Jiu'],
  ['CSKA-Sofia', 'CSKA Sofia'],
  ['Pafos', 'Pafos FC'],
  ["Hapoel Be'er Sheva", 'Hapoel Beer Sheva'],
  ['Kasımpaşa', 'Kasimpasa'], ['Fenerbahçe', 'Fenerbahce'],
  ['ACSC FC Arges', 'FC Arges'], ['FC Arges Pitesti', 'FC Arges'],
  ['ACSM Resita', 'CSM Resita'],
  ['AFC Unirea 04 Slobozia', 'Unirea Slobozia'],
  ['AFC Metalul Buzau', 'Metalul Buzau'],
  ['FC Metaloglobus Bucharest', 'Metaloglobus'],
  ['Sanatatea', 'Sanatatea Cluj'],
  ['Politehnica Timișoara', 'Politehnica Timisoara'],
  ['Royal Excel Mouscron (-2022)', 'Royal Excel Mouscron'],
  ['O. Secuiesc', 'AFC Odorheiu Secuiesc'],
  ['CSM Ceahlaul Piatra Neamt', 'CSM Ceahlăul Piatra Neamț'],
  ['Ceahlăul Piatra Neamț', 'CSM Ceahlăul Piatra Neamț'],
]);

const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const write = (name, text) => fs.writeFileSync(path.join(ROOT, name), text, 'utf8');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const uniq = (xs) => [...new Set(xs.map(String))];
const idsFrom = (html) => uniq([...html.matchAll(/data-player-id="(\d+)"/g)].map((m) => m[1]));
const chunks = (xs, size) => Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size));

async function getJson(url, attempts = 5) {
  let last;
  for (let n = 0; n < attempts; n += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'TMGH-static-refresh/1.0' } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const json = await response.json();
      if (json?.success === false) throw new Error(json.message || 'API error');
      return json;
    } catch (error) {
      last = error;
      await sleep(700 * (n + 1));
    }
  }
  throw last;
}

async function parallelMap(items, concurrency, worker, label) {
  const result = new Array(items.length);
  let next = 0;
  let done = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try {
        result[index] = await worker(items[index], index);
      } catch (error) {
        result[index] = { __error: String(error?.message || error) };
      }
      done += 1;
      if (done % 25 === 0 || done === items.length) console.log(`${label}: ${done}/${items.length}`);
    }
  });
  await Promise.all(runners);
  return result;
}

function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function regexpEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unifyTeamNames(html) {
  for (const [alias, canonical] of [...TEAM_NAME_ALIASES].sort((a, b) => b[0].length - a[0].length)) {
    const source = regexpEscape(alias);
    html = html
      .replace(new RegExp(`="${source}"`, 'g'), `="${canonical}"`)
      .replace(new RegExp(`>${source}<`, 'g'), `>${canonical}<`)
      .replace(new RegExp(`>${source} ([–-]) `, 'g'), `>${canonical} $1 `)
      .replace(new RegExp(` ([–-]) ${source}<`, 'g'), ` $1 ${canonical}<`);
  }
  html = html.replace(/<select\b[^>]*>[\s\S]*?<\/select>/gi, (select) => {
    const seen = new Set();
    return select.replace(/<option\b[^>]*value="([^"]*)"[^>]*>[\s\S]*?<\/option>/gi, (option, value) => {
      if (seen.has(value)) return '';
      seen.add(value);
      return option;
    });
  });
  return html;
}

function stripHtml(value) {
  let text = String(value ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ');
  // A korábbi statikus exportokban néhány felirat többszörösen volt HTML-kódolva.
  // Ismételt dekódolással a frissítés idempotens marad, nem halmozódik az &amp;.
  for (let pass = 0; pass < 3; pass += 1) {
    const decoded = text
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#(?:0*39);|&#x27;/gi, "'");
    if (decoded === text) break;
    text = decoded;
  }
  return text
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(value) {
  return stripHtml(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function getAttr(open, name) {
  return open.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))?.[1] ?? '';
}

function setAttr(open, name, value) {
  const attr = `${name}="${esc(value)}"`;
  const regex = new RegExp(`\\b${name}="[^"]*"`, 'i');
  return regex.test(open) ? open.replace(regex, attr) : open.replace(/>\s*$/, ` ${attr}>`);
}

function formatPlayerMoney(value) {
  const n = Number(value) || 0;
  if (!n) return '—';
  if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(2)}m`;
  return `€${Math.round(n / 1000)}k`;
}

function formatTeamMoney(value) {
  const n = Number(value) || 0;
  if (!n) return '';
  if (n >= 1_000_000) {
    const raw = (n / 1_000_000).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
    return `€${raw}m`;
  }
  return `€${Math.round(n / 1000)}k`;
}

function displayDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function replaceCell(row, label, inner) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(<td\\b[^>]*data-label="${escaped}"[^>]*>)[\\s\\S]*?(<\\/td>)`, 'i');
  return row.replace(regex, `$1${inner}$2`);
}

function cellInner(row, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return row.match(new RegExp(`<td\\b[^>]*data-label="${escaped}"[^>]*>([\\s\\S]*?)<\\/td>`, 'i'))?.[1] ?? '';
}

function rowOpen(row) {
  return row.match(/^<tr\b[\s\S]*?>/)?.[0] ?? '';
}

function replaceRowOpen(row, open) {
  return row.replace(/^<tr\b[\s\S]*?>/, open);
}

function clubState(player, clubs) {
  const assignment = (player?.clubAssignments || []).find((a) => a.type === 'current');
  const club = assignment ? clubs.get(String(assignment.clubId)) : null;
  const rawName = club?.name || '';
  const key = normalize(rawName);
  if (key === 'retired' || key === 'career end' || key === 'kariyer sonu') return { name: 'Retired', status: 'retired', clubId: assignment?.clubId };
  if (!club || key === 'without club' || key === 'free agent' || key === 'vereinslos') return { name: 'Free agent', status: 'free-agent', clubId: assignment?.clubId };
  return { name: rawName, status: 'active', clubId: assignment.clubId };
}

function updateCurrentPlayerRow(row, player, clubs) {
  if (!player) return row;
  const current = player.marketValueDetails?.current || {};
  const highest = player.marketValueDetails?.highest || {};
  const state = clubState(player, clubs);
  const oldPeak = Number(getAttr(rowOpen(row), 'data-peak')) || 0;
  const peakClubInner = cellInner(row, 'Peak MV klub');
  const currentClubInner = `<strong>${esc(state.name)}</strong>`;
  const currentMvInner = `<span class="value">${formatPlayerMoney(current.value)}</span>${current.determined ? `<span>snapshot: ${displayDate(current.determined)}</span>` : ''}`;
  const peakMvInner = `<span class="value">${formatPlayerMoney(highest.value)}</span>${highest.determined ? `<span>snapshot: ${displayDate(highest.determined)}</span>` : ''}`;
  let peakClub = peakClubInner;
  if ((!stripHtml(peakClubInner) || (Number(highest.value) > oldPeak && Number(highest.value) === Number(current.value))) && state.status === 'active') {
    peakClub = `<strong>${esc(state.name)}</strong>`;
  }
  row = replaceCell(row, 'Mostani klub / státusz', currentClubInner);
  row = replaceCell(row, 'Jelenlegi MV', currentMvInner);
  row = replaceCell(row, 'All-time Peak MV', peakMvInner);
  if (peakClub !== peakClubInner) row = replaceCell(row, 'Peak MV klub', peakClub);
  let open = rowOpen(row);
  open = setAttr(open, 'data-status', state.status);
  open = setAttr(open, 'data-current-mv', Number(current.value) || 0);
  open = setAttr(open, 'data-peak', Number(highest.value) || 0);
  return replaceRowOpen(row, open);
}

function aggregateTop5(performance) {
  const result = new Map([...LEAGUES.keys()].map((id) => [id, { apps: 0, minutes: 0 }]));
  for (const item of performance || []) {
    const id = item?.gameInformation?.competitionId;
    if (!result.has(id) || item?.gameInformation?.isNationalGame) continue;
    const general = item?.statistics?.generalStatistics;
    const minutes = Number(item?.statistics?.playingTimeStatistics?.playedMinutes) || 0;
    if (general?.participationState !== 'played' && minutes <= 0) continue;
    const stat = result.get(id);
    stat.apps += 1;
    stat.minutes += minutes;
  }
  return new Map([...result].filter(([, stat]) => stat.apps > 0));
}

function updateTop5Row(row, stats) {
  if (!stats) return row;
  const badges = top5Badges(stats);
  row = replaceCell(row, 'Top-5 liga/app', badges);
  let open = rowOpen(row);
  open = setAttr(open, 'data-leagues', `|${[...stats.keys()].join('|')}|`);
  open = setAttr(open, 'data-total-apps', [...stats.values()].reduce((sum, stat) => sum + stat.apps, 0));
  return replaceRowOpen(row, open);
}

function top5Badges(stats) {
  return [...(stats || [])]
    .map(([id, stat]) => `<span class="badge league-${id}">${LEAGUES.get(id)} · ${stat.apps} / ${stat.minutes}p</span>`)
    .join(' ');
}

function playerRows(html, id = '') {
  const rows = [...String(html || '').matchAll(/<tr\b[^>]*data-player-id="(\d+)"[^>]*>[\s\S]*?<\/tr>/g)]
    .map((m) => m[0]);
  return id ? rows.filter((row) => getAttr(rowOpen(row), 'data-player-id') === String(id)) : rows;
}

function convertCappedRowToTop5(row, stats) {
  row = replaceCell(row, 'Válogatott / meccs / gól', top5Badges(stats));
  row = row.replace('data-label="Válogatott / meccs / gól"', 'data-label="Top-5 liga/app"');
  let open = rowOpen(row)
    .replace(/\s+data-nationality-tokens="[^"]*"/i, '')
    .replace(/\s+data-national-teams="[^"]*"/i, '');
  open = setAttr(open, 'data-leagues', `|${[...stats.keys()].join('|')}|`);
  open = setAttr(open, 'data-total-apps', [...stats.values()].reduce((sum, stat) => sum + stat.apps, 0));
  return replaceRowOpen(row, open);
}

function convertRomanianRowToTop5(row, stats) {
  const open = rowOpen(row);
  const id = getAttr(open, 'data-player-id');
  const player = getAttr(open, 'data-player');
  const nationality = getAttr(open, 'data-nationality');
  const seenClub = getAttr(open, 'data-club');
  const competition = getAttr(open, 'data-competition');
  const season = getAttr(open, 'data-season');
  const round = getAttr(open, 'data-round');
  const playerCell = cellInner(row, 'Játékos');
  const href = playerCell.match(/href="([^"]+)"/i)?.[1] || `https://www.transfermarkt.com/-/profil/spieler/${id}`;
  const displayName = playerCell.match(/<strong>([^<]+)<\/strong>/i)?.[1] || player;
  const matchCell = row.match(/<td\b[^>]*class="[^"]*match-cell[^"]*"[^>]*data-label="Látott meccs \/ eredmény"[^>]*>[\s\S]*?<\/td>/i)?.[0] || '';
  const attrs = [
    ['data-player-id', id], ['data-player', normalize(player)], ['data-season', season],
    ['data-seen-club', seenClub], ['data-club-at-match', seenClub], ['data-nationality', nationality],
    ['data-leagues', `|${[...stats.keys()].join('|')}|`],
    ['data-total-apps', [...stats.values()].reduce((sum, stat) => sum + stat.apps, 0)],
    ['data-competition', competition], ['data-round', round],
    ['data-status', getAttr(open, 'data-status')], ['data-current-mv', getAttr(open, 'data-current-mv')],
    ['data-peak', getAttr(open, 'data-peak')],
  ].map(([key, value]) => `${key}="${esc(value)}"`).join(' ');
  return `<tr ${attrs}>
        <td data-label="Játékos"><a href="${esc(href)}" target="_blank" rel="noopener"><strong>${displayName}</strong></a><span>ID: ${id}</span></td>
        <td data-label="Nemzetiség"><strong>${esc(nationality)}</strong></td>
        <td data-label="Top-5 liga/app">${top5Badges(stats)}</td>
        <td data-label="Látott csapat"><strong>${esc(seenClub)}</strong></td>
        <td data-label="Látáskori klub"><strong>${esc(seenClub)}</strong></td>
        <td data-label="Látáskori MV">${cellInner(row, 'Látáskori MV')}</td>
        <td data-label="Mostani klub / státusz">${cellInner(row, 'Mostani klub / státusz')}</td>
        <td data-label="Jelenlegi MV">${cellInner(row, 'Jelenlegi MV')}</td>
        <td data-label="All-time Peak MV">${cellInner(row, 'All-time Peak MV')}</td>
        <td data-label="Peak MV klub">${cellInner(row, 'Peak MV klub')}</td>
        ${matchCell}
        <td data-label="Verseny">${cellInner(row, 'Verseny')}</td>
        <td data-label="Szezon">${cellInner(row, 'Szezon')}</td>
        <td data-label="Forduló / fázis / meccsnap">${cellInner(row, 'Forduló / fázis / meccsnap')}</td>
      </tr>`;
}

function addNewTop5Rows(topHtml, cappedHtml, romanianHtml, newIds, performance) {
  const added = [];
  for (const id of newIds) {
    const stats = performance.get(id);
    if (!stats?.size) continue;
    const capped = playerRows(cappedHtml, id);
    const sources = capped.length ? capped.map((row) => convertCappedRowToTop5(row, stats)) :
      playerRows(romanianHtml, id).map((row) => convertRomanianRowToTop5(row, stats));
    added.push(...sources);
  }
  if (!added.length) return { html: topHtml, added: 0 };
  const tbody = topHtml.match(/(<tbody\b[^>]*id="results-body"[^>]*>)([\s\S]*?)(<\/tbody>)/i);
  if (!tbody) throw new Error('A Top-5 tbody nem található.');
  let allRows = [...playerRows(tbody[2]), ...added];
  allRows.sort((a, b) => {
    const ao = rowOpen(a); const bo = rowOpen(b);
    const peak = Number(getAttr(bo, 'data-peak')) - Number(getAttr(ao, 'data-peak'));
    if (peak) return peak;
    const apps = Number(getAttr(bo, 'data-total-apps')) - Number(getAttr(ao, 'data-total-apps'));
    if (apps) return apps;
    const name = getAttr(ao, 'data-player').localeCompare(getAttr(bo, 'data-player'), 'hu', { sensitivity: 'base' });
    if (name) return name;
    const ad = a.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || '';
    const bd = b.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || '';
    return ad.localeCompare(bd);
  });
  topHtml = topHtml.replace(tbody[0], `${tbody[1]}\n${allRows.join('\n')}\n${tbody[3]}`);
  const uniquePlayers = new Set(allRows.map((row) => getAttr(rowOpen(row), 'data-player-id'))).size;
  topHtml = topHtml
    .replace(/(<strong id="stat-players">)\d+(<\/strong>)/, `$1${uniquePlayers}$2`)
    .replace(/(<strong id="stat-rows">)\d+(<\/strong>)/, `$1${allRows.length}$2`)
    .replace(/(<div class="filter-summary" id="filter-summary">)\d+ játékos · \d+ meccssor(<\/div>)/, `$1${uniquePlayers} játékos · ${allRows.length} meccssor$2`);
  return { html: updateAppsSummary(topHtml), added: added.length };
}

function nationalBadgeData(entries, clubs) {
  const valid = (entries || []).filter((entry) => Number(entry.gamesPlayed || 0) > 0);
  return {
    html: valid.map((entry) => {
      const name = clubs.get(String(entry.clubId))?.name || 'National team';
      return `<span class="badge">${esc(name)} · ${Number(entry.gamesPlayed) || 0} meccs · ${Number(entry.goalsScored) || 0} gól</span>`;
    }).join(' '),
    total: valid.reduce((sum, entry) => sum + (Number(entry.gamesPlayed) || 0), 0),
    tokens: valid.map((entry) => `name:${filterTeamToken(clubs.get(String(entry.clubId))?.name || '')}`),
    teams: valid.map((entry) => clubs.get(String(entry.clubId))?.name || '').filter(Boolean),
  };
}

function convertTop5RowToCapped(row, entries, clubs) {
  const badge = nationalBadgeData(entries, clubs);
  row = replaceCell(row, 'Top-5 liga/app', badge.html);
  row = row.replace('data-label="Top-5 liga/app"', 'data-label="Válogatott / meccs / gól"');
  let open = rowOpen(row).replace(/\s+data-leagues="[^"]*"/i, '');
  open = setAttr(open, 'data-nationality-tokens', `|${getAttr(open, 'data-nationality')}|`);
  open = setAttr(open, 'data-national-teams', `|${badge.tokens.join('|')}|`);
  open = setAttr(open, 'data-total-apps', badge.total);
  return replaceRowOpen(row, open);
}

function addNationalFilterOptions(html, teams) {
  const additions = new Map((teams || []).map((team) => [`name:${filterTeamToken(team)}`, team]));
  if (!additions.size) return html;
  const match = html.match(/(<div class="multi-options">)([\s\S]*?)(<\/div>)/i);
  if (!match) return html;
  const options = new Map();
  for (const item of match[2].matchAll(/<label class="multi-option">[\s\S]*?<input type="checkbox" value="([^"]+)">[\s\S]*?<span>([\s\S]*?)<\/span>[\s\S]*?<\/label>/gi)) {
    options.set(item[1].replace(/&#039;/g, "'"), stripHtml(item[2]));
  }
  for (const [token, team] of additions) if (!options.has(token)) options.set(token, team);
  const body = [...options]
    .sort((a, b) => a[1].localeCompare(b[1], 'hu', { sensitivity: 'base' }))
    .map(([token, team]) => `<label class="multi-option"><input type="checkbox" value="${esc(token)}"><span>${esc(team)}</span></label>`)
    .join('\n');
  return html.replace(match[0], `${match[1]}\n${body}\n${match[3]}`);
}

function addNewCappedRows(cappedHtml, topHtml, romanianHtml, newIds, national, clubs, performance) {
  const added = [];
  const teams = [];
  for (const id of newIds) {
    const entries = seniorNationalHistory(id);
    if (!entries.length) continue;
    const top = playerRows(topHtml, id);
    const fallbackTop = playerRows(romanianHtml, id).map((row) => convertRomanianRowToTop5(row, performance.get(id) || new Map()));
    const sources = top.length ? top : fallbackTop;
    added.push(...sources.map((row) => convertTop5RowToCapped(row, entries, clubs)));
    teams.push(...nationalBadgeData(entries, clubs).teams);
  }
  if (!added.length) return { html: cappedHtml, added: 0 };
  const tbody = cappedHtml.match(/(<tbody\b[^>]*id="results-body"[^>]*>)([\s\S]*?)(<\/tbody>)/i);
  if (!tbody) throw new Error('A válogatott tbody nem található.');
  const allRows = [...playerRows(tbody[2]), ...added];
  allRows.sort((a, b) => {
    const ao = rowOpen(a); const bo = rowOpen(b);
    const peak = Number(getAttr(bo, 'data-peak')) - Number(getAttr(ao, 'data-peak'));
    if (peak) return peak;
    const caps = Number(getAttr(bo, 'data-total-apps')) - Number(getAttr(ao, 'data-total-apps'));
    if (caps) return caps;
    const name = getAttr(ao, 'data-player').localeCompare(getAttr(bo, 'data-player'), 'hu', { sensitivity: 'base' });
    if (name) return name;
    const ad = a.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || '';
    const bd = b.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || '';
    return ad.localeCompare(bd);
  });
  cappedHtml = cappedHtml.replace(tbody[0], `${tbody[1]}\n${allRows.join('\n')}\n${tbody[3]}`);
  const uniquePlayers = new Set(allRows.map((row) => getAttr(rowOpen(row), 'data-player-id'))).size;
  cappedHtml = cappedHtml
    .replace(/(<strong id="stat-players">)\d+(<\/strong>)/, `$1${uniquePlayers}$2`)
    .replace(/(<strong id="stat-rows">)\d+(<\/strong>)/, `$1${allRows.length}$2`)
    .replace(/(<div class="filter-summary" id="filter-summary">)\d+ játékos · \d+ meccssor(<\/div>)/, `$1${uniquePlayers} játékos · ${allRows.length} meccssor$2`);
  cappedHtml = addNationalFilterOptions(cappedHtml, teams);
  return { html: updateAppsSummary(cappedHtml), added: added.length };
}

function aliases(value) {
  const n = normalize(value);
  const map = new Map([
    ['dr congo', 'congo dr'],
    ['democratic republic of the congo', 'congo dr'],
    ['congo democratic republic', 'congo dr'],
    ['congo', 'congo dr'],
    ['cote d ivoire', 'ivory coast'],
    ['usa', 'united states'],
    ['south korea', 'korea republic'],
  ]);
  return map.get(n) || n;
}

function filterTeamToken(value) {
  const n = normalize(value);
  const map = new Map([
    ['the gambia', 'gambia'],
    ['bosnia herzegovina', 'bosnia-herzegovina'],
    ['republic of the congo', 'congo'],
    ['democratic republic of the congo', 'congo'],
    ['congo dr', 'congo'],
    ['guinea bissau', 'guinea-bissau'],
    ['ivory coast', "cote d'ivoire"],
    ['cote d ivoire', "cote d'ivoire"],
    ['cape verde', 'cape-verde'],
    ['turkiye', 'turkey'],
    ['equatorial guinea', 'equatorial-guinea'],
    ['slowenien b', 'slovenia'],
  ]);
  return map.get(n) || n;
}

function updateCappedRow(row, history, clubs) {
  if (!history?.length) return row;
  const inner = cellInner(row, 'Válogatott / meccs / gól');
  const badgeRegex = /<span\b[^>]*class="[^"]*badge[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
  let found = false;
  let total = 0;
  const next = inner.replace(badgeRegex, (full, body) => {
    const text = stripHtml(body);
    const m = text.match(/^(.*?)\s*·\s*\d+\s+meccs\s*·\s*\d+\s+gól$/i);
    if (!m) return full;
    const team = m[1].trim();
    const target = aliases(team);
    let item = history.find((h) => aliases(clubs.get(String(h.clubId))?.name) === target);
    if (!item) {
      const senior = history.filter((h) => !/\bu\d{2}\b|olympic|b team|ii$/i.test(clubs.get(String(h.clubId))?.name || ''));
      if (senior.length === 1) item = senior[0];
    }
    if (!item) return full;
    found = true;
    total += Number(item.gamesPlayed) || 0;
    const canonical = clubs.get(String(item.clubId))?.name || team;
    return `<span class="badge">${esc(canonical)} · ${Number(item.gamesPlayed) || 0} meccs · ${Number(item.goalsScored) || 0} gól</span>`;
  });
  if (!found) return row;
  row = replaceCell(row, 'Válogatott / meccs / gól', next);
  let open = rowOpen(row);
  open = setAttr(open, 'data-total-apps', total);
  const teams = [...next.matchAll(/<span\b[^>]*class="[^"]*badge[^"]*"[^>]*>(.*?)\s*·/gi)].map((m) => `name:${filterTeamToken(m[1])}`);
  if (teams.length) open = setAttr(open, 'data-national-teams', `|${teams.join('|')}|`);
  return replaceRowOpen(row, open);
}

function rebuildRomanianSearch(row) {
  let open = rowOpen(row);
  const attrs = ['data-player-id', 'data-player', 'data-type', 'data-nationality', 'data-club', 'data-competition', 'data-season', 'data-round', 'data-status', 'data-team-count', 'data-peak', 'data-seen-mv', 'data-current-mv', 'data-date', 'data-year'];
  const text = `${attrs.map((a) => getAttr(open, a)).join(' ')} ${stripHtml(row)}`.toLowerCase().replace(/\s+/g, ' ').trim();
  open = setAttr(open, 'data-search', text);
  return replaceRowOpen(row, open);
}

function updateRows(html, updater) {
  return html.replace(/<tr\b(?=[\s\S]*?data-player-id="\d+")[\s\S]*?<\/tr>/g, (row) => {
    const id = getAttr(rowOpen(row), 'data-player-id');
    return updater(row, id);
  });
}

function updateDates(html) {
  return html
    .replace(/data-static-export="[^"]*"/g, `data-static-export="${AS_OF}-full-current-data-refresh"`)
    .replace(/jelenlegi játékosadatok frissítve:\s*\d{4}-\d{2}-\d{2}/g, `jelenlegi játékosadatok frissítve: ${AS_OF}`);
}

function updateAppsSummary(html) {
  const byPlayer = new Map();
  for (const match of html.matchAll(/<tr\b(?=[\s\S]*?data-player-id="(\d+)")(?=[\s\S]*?data-total-apps="(\d+)")[\s\S]*?<\/tr>/g)) {
    byPlayer.set(match[1], Number(match[2]) || 0);
  }
  const total = [...byPlayer.values()].reduce((sum, value) => sum + value, 0);
  return html.replace(/(<strong id="stat-apps">)\d+(<\/strong>)/, `$1${total}$2`);
}

function updateMatchRows(html, clubs) {
  html = html.replace(/<tr\b[^>]*data-home-club-id="\d+"[^>]*data-away-club-id="\d+"[^>]*>[\s\S]*?<\/tr>/g, (row) => {
    const open = rowOpen(row);
    const home = clubs.get(getAttr(open, 'data-home-club-id'));
    const away = clubs.get(getAttr(open, 'data-away-club-id'));
    const homeValue = Number(home?.squadDetails?.currentMarketValue?.value) || 0;
    const awayValue = Number(away?.squadDetails?.currentMarketValue?.value) || 0;
    row = replaceCell(row, 'Hazai jelenlegi MV', homeValue ? `<span class="value">${formatTeamMoney(homeValue)}</span>` : '');
    row = replaceCell(row, 'Vendég jelenlegi MV', awayValue ? `<span class="value">${formatTeamMoney(awayValue)}</span>` : '');
    return row;
  });
  return html
    .replace(/data-current-team-values-as-of="[^"]*"/g, `data-current-team-values-as-of="${AS_OF}"`)
    .replace(/data-static-export="[^"]*"/g, `data-static-export="${AS_OF}-full-current-data-refresh"`)
    .replace(/egységes statikus export:\s*\d{4}-\d{2}-\d{2}/g, `egységes statikus export: ${AS_OF}`);
}

const htmlByFile = new Map(PLAYER_FILES.map((name) => [name, read(name)]));
const playerIds = uniq(PLAYER_FILES.flatMap((name) => idsFrom(htmlByFile.get(name))));
const top5Ids = idsFrom(htmlByFile.get(TOP5_FILE));
const cappedIds = idsFrom(htmlByFile.get(CAPPED_FILE));
const matchHtml = read(MATCH_FILE);
const matchClubIds = uniq([...matchHtml.matchAll(/data-(?:home|away)-club-id="(\d+)"/g)].map((m) => m[1]));
console.log(`Egyedi játékos: ${playerIds.length}; Top-5 stat: ${top5Ids.length}; válogatott stat: ${cappedIds.length}; meccses klub: ${matchClubIds.length}`);

const playerBatches = await parallelMap(chunks(playerIds, 45), 3, async (batch) => {
  const query = batch.map((id) => `ids[]=${encodeURIComponent(id)}`).join('&');
  return (await getJson(`https://tmapi.transfermarkt.technology/players?${query}`)).data || [];
}, 'Játékoscsomagok');
const players = new Map(playerBatches.flatMap((x) => Array.isArray(x) ? x : []).map((p) => [String(p.id), p]));
console.log(`Játékosprofilok rendben: ${players.size}/${playerIds.length}`);

const nationalRaw = await parallelMap(playerIds, 10, async (id) => {
  const data = (await getJson(`https://tmapi.transfermarkt.technology/player/${id}/national-career-history`)).data;
  return { id, history: data?.history || [], clubIds: data?.clubIds || [] };
}, 'Teljes válogatott-jogosultságvizsgálat');
const national = new Map(nationalRaw.filter((x) => x && !x.__error).map((x) => [x.id, x.history]));

// A userscript logikája szerint nem csak a már Top-5 oldalon szereplőket
// ellenőrizzük: a teljes ismert látott játékospool új jogosultjait is keressük.
const performanceRaw = await parallelMap(playerIds, 8, async (id) => {
  const data = (await getJson(`https://tmapi.transfermarkt.technology/player/${id}/performance-game`, 4)).data;
  return { id, stats: aggregateTop5(data?.performance || []) };
}, 'Teljes Top-5 jogosultságvizsgálat');
const performance = new Map(performanceRaw.filter((x) => x && !x.__error).map((x) => [x.id, x.stats]));
const newTop5Ids = playerIds.filter((id) => !top5Ids.includes(id) && (performance.get(id)?.size || 0) > 0);
console.log(`Új Top-5 jogosultak a jelenlegi poolban: ${newTop5Ids.length}${newTop5Ids.length ? ` (${newTop5Ids.join(', ')})` : ''}`);

const currentClubIds = [...players.values()].flatMap((p) => (p.clubAssignments || []).filter((a) => a.type === 'current').map((a) => a.clubId));
const nationalClubIds = nationalRaw.flatMap((x) => x?.clubIds || []);
const clubIds = uniq([...matchClubIds, ...currentClubIds, ...nationalClubIds]);
const clubBatches = await parallelMap(chunks(clubIds, 45), 3, async (batch) => {
  const query = batch.map((id) => `ids[]=${encodeURIComponent(id)}`).join('&');
  return (await getJson(`https://tmapi.transfermarkt.technology/clubs?${query}`)).data || [];
}, 'Klubcsomagok');
const clubs = new Map(clubBatches.flatMap((x) => Array.isArray(x) ? x : []).map((c) => [String(c.id), c]));
console.log(`Klubadatok rendben: ${clubs.size}/${clubIds.length}`);
const seniorNationalHistory = (id) => (national.get(String(id)) || []).filter((entry) => {
  const name = clubs.get(String(entry.clubId))?.name || '';
  return Number(entry.gamesPlayed || 0) > 0 &&
    !/\b(?:u\s?1[56789]|u\s?2[013]|under[- ]?(?:17|18|19|20|21|23)|olympic|b team|ii|a2)\b/i.test(name);
});
const newCappedIds = playerIds.filter((id) => !cappedIds.includes(id) && seniorNationalHistory(id).length > 0);
console.log(`Új felnőtt válogatott jogosultak a jelenlegi poolban: ${newCappedIds.length}${newCappedIds.length ? ` (${newCappedIds.join(', ')})` : ''}`);

const updatedHtmlByFile = new Map();
for (const name of PLAYER_FILES) {
  let html = htmlByFile.get(name);
  html = updateRows(html, (row, id) => {
    row = updateCurrentPlayerRow(row, players.get(id), clubs);
    if (name === TOP5_FILE) row = updateTop5Row(row, performance.get(id));
    if (name === CAPPED_FILE) row = updateCappedRow(row, national.get(id), clubs);
    if (name === 'Romanian Club-National Players Seen Live.html') row = rebuildRomanianSearch(row);
    return row;
  });
  html = updateDates(html);
  if (name === TOP5_FILE || name === CAPPED_FILE) html = updateAppsSummary(html);
  updatedHtmlByFile.set(name, html);
}

const top5Addition = addNewTop5Rows(
  updatedHtmlByFile.get(TOP5_FILE),
  updatedHtmlByFile.get(CAPPED_FILE),
  updatedHtmlByFile.get('Romanian Club-National Players Seen Live.html'),
  newTop5Ids,
  performance,
);
updatedHtmlByFile.set(TOP5_FILE, top5Addition.html);
console.log(`Új Top-5 meccssorok beillesztve: ${top5Addition.added}`);

const cappedAddition = addNewCappedRows(
  updatedHtmlByFile.get(CAPPED_FILE),
  updatedHtmlByFile.get(TOP5_FILE),
  updatedHtmlByFile.get('Romanian Club-National Players Seen Live.html'),
  newCappedIds,
  national,
  clubs,
  performance,
);
updatedHtmlByFile.set(CAPPED_FILE, cappedAddition.html);
console.log(`Új válogatott meccssorok beillesztve: ${cappedAddition.added}`);

const auditPath = path.join(ROOT, 'tools', 'unlisted-seen-player-audit.json');
if (fs.existsSync(auditPath)) {
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  const fullPool = Number(audit.knownPlayers || 0) + Number(audit.previouslyUnlistedActualPlayers || 0);
  if (fullPool > 0) {
    for (const name of [TOP5_FILE, CAPPED_FILE]) {
      updatedHtmlByFile.set(name, updatedHtmlByFile.get(name).replace(/(<strong id="stat-pool">)\d+(<\/strong>)/, `$1${fullPool}$2`));
    }
  }
}

for (const [name, originalHtml] of updatedHtmlByFile) {
  let html = unifyTeamNames(originalHtml);
  if (name === 'Romanian Club-National Players Seen Live.html') {
    html = updateRows(html, (row) => rebuildRomanianSearch(row));
    const clubCount = new Set(playerRows(html).map((row) => getAttr(rowOpen(row), 'data-club')).filter(Boolean)).size;
    html = html.replace(/(<strong id="statClubs">)\d+(<\/strong>)/, `$1${clubCount}$2`);
  }
  html = normalizeFilterOptionOrder(html);
  updatedHtmlByFile.set(name, html);
  write(name, html);
  console.log(`Frissítve: ${name}`);
}

write(MATCH_FILE, normalizeFilterOptionOrder(unifyTeamNames(updateMatchRows(matchHtml, clubs))));
console.log(`Frissítve: ${MATCH_FILE}`);

const pageCounts = {
  matches: [...matchHtml.matchAll(/data-home-club-id="/g)].length,
  top5: playerRows(updatedHtmlByFile.get(TOP5_FILE)).length,
  capped: playerRows(updatedHtmlByFile.get(CAPPED_FILE)).length,
  tournaments: playerRows(updatedHtmlByFile.get('Euro-WC Players Seen Live.html')).length,
  romanian: playerRows(updatedHtmlByFile.get('Romanian Club-National Players Seen Live.html')).length,
};
const totalRows = Object.values(pageCounts).reduce((sum, value) => sum + value, 0);
for (const hubName of ['index.html', 'TM Groundhopping Hub.html']) {
  let hub = read(hubName);
  hub = hub
    .replace(/(<div class="summary-card"><span>Táblázatsor<\/span><strong>)[\d ]+(<\/strong>)/, `$1${totalRows.toLocaleString('hu-HU')}$2`)
    .replace(/(id:'matches'[\s\S]*?meta:')[\d ]+ mérkőzés'/, `$1${pageCounts.matches} mérkőzés'`)
    .replace(/(id:'top5'[\s\S]*?meta:')[\d ]+ sor'/, `$1${pageCounts.top5.toLocaleString('hu-HU')} sor'`)
    .replace(/(id:'capped'[\s\S]*?meta:')[\d ]+ sor'/, `$1${pageCounts.capped.toLocaleString('hu-HU')} sor'`)
    .replace(/(id:'tournaments'[\s\S]*?meta:')[\d ]+ sor'/, `$1${pageCounts.tournaments.toLocaleString('hu-HU')} sor'`)
    .replace(/(id:'romanian'[\s\S]*?meta:')[\d ]+ sor'/, `$1${pageCounts.romanian.toLocaleString('hu-HU')} sor'`);
  write(hubName, hub);
}

const failures = {
  missingPlayers: playerIds.filter((id) => !players.has(id)),
  national: nationalRaw.filter((x) => x?.__error).length,
  performance: performanceRaw.filter((x) => x?.__error).length,
  newTop5Ids,
  newCappedIds,
  missingClubs: clubIds.filter((id) => !clubs.has(id)),
};
fs.writeFileSync(path.join(ROOT, 'tools', 'refresh-current-data-report.json'), JSON.stringify({ asOf: AS_OF, counts: { players: players.size, clubs: clubs.size, national: national.size, performance: performance.size }, failures }, null, 2));
console.log('Kész.', JSON.stringify(failures));
