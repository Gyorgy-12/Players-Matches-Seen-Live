import fs from 'node:fs';
import path from 'node:path';

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

function stripHtml(value) {
  return String(value ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
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
  const badges = [...stats]
    .map(([id, stat]) => `<span class="badge league-${id}">${LEAGUES.get(id)} · ${stat.apps} / ${stat.minutes}p</span>`)
    .join(' ');
  row = replaceCell(row, 'Top-5 liga/app', badges);
  let open = rowOpen(row);
  open = setAttr(open, 'data-leagues', `|${[...stats.keys()].join('|')}|`);
  open = setAttr(open, 'data-total-apps', [...stats.values()].reduce((sum, stat) => sum + stat.apps, 0));
  return replaceRowOpen(row, open);
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

const nationalRaw = await parallelMap(cappedIds, 7, async (id) => {
  const data = (await getJson(`https://tmapi.transfermarkt.technology/player/${id}/national-career-history`)).data;
  return { id, history: data?.history || [], clubIds: data?.clubIds || [] };
}, 'Válogatott karrierek');
const national = new Map(nationalRaw.filter((x) => x && !x.__error).map((x) => [x.id, x.history]));

const performanceRaw = await parallelMap(top5Ids, 4, async (id) => {
  const data = (await getJson(`https://tmapi.transfermarkt.technology/player/${id}/performance-game`, 4)).data;
  return { id, stats: aggregateTop5(data?.performance || []) };
}, 'Top-5 karrierek');
const performance = new Map(performanceRaw.filter((x) => x && !x.__error).map((x) => [x.id, x.stats]));

const currentClubIds = [...players.values()].flatMap((p) => (p.clubAssignments || []).filter((a) => a.type === 'current').map((a) => a.clubId));
const nationalClubIds = nationalRaw.flatMap((x) => x?.clubIds || []);
const clubIds = uniq([...matchClubIds, ...currentClubIds, ...nationalClubIds]);
const clubBatches = await parallelMap(chunks(clubIds, 45), 3, async (batch) => {
  const query = batch.map((id) => `ids[]=${encodeURIComponent(id)}`).join('&');
  return (await getJson(`https://tmapi.transfermarkt.technology/clubs?${query}`)).data || [];
}, 'Klubcsomagok');
const clubs = new Map(clubBatches.flatMap((x) => Array.isArray(x) ? x : []).map((c) => [String(c.id), c]));
console.log(`Klubadatok rendben: ${clubs.size}/${clubIds.length}`);

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
  write(name, html);
  console.log(`Frissítve: ${name}`);
}

write(MATCH_FILE, updateMatchRows(matchHtml, clubs));
console.log(`Frissítve: ${MATCH_FILE}`);

const failures = {
  missingPlayers: playerIds.filter((id) => !players.has(id)),
  national: nationalRaw.filter((x) => x?.__error).length,
  performance: performanceRaw.filter((x) => x?.__error).length,
  missingClubs: clubIds.filter((id) => !clubs.has(id)),
};
fs.writeFileSync(path.join(ROOT, 'tools', 'refresh-current-data-report.json'), JSON.stringify({ asOf: AS_OF, counts: { players: players.size, clubs: clubs.size, national: national.size, performance: performance.size }, failures }, null, 2));
console.log('Kész.', JSON.stringify(failures));
