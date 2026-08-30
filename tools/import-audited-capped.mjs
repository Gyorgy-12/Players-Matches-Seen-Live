import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const cappedFile = 'Capped Players Seen Live.html';
const audit = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'unlisted-seen-player-audit.json'), 'utf8'));
let capped = fs.readFileSync(path.join(root, cappedFile), 'utf8');
const matchesHtml = fs.readFileSync(path.join(root, 'All Seen Matches.html'), 'utf8');
const existing = new Set([...capped.matchAll(/data-player-id="(\d+)"/g)].map((m) => m[1]));
const targets = (audit.eligible || []).filter((item) => item.seniorNationalTeams?.length && !existing.has(String(item.id)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const strip = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const attr = (open, name) => open.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))?.[1] || '';
const rowOpen = (row) => row.match(/^<tr\b[\s\S]*?>/)?.[0] || '';
const money = (n) => !Number(n) ? '—' : Number(n) >= 1e6 ? `€${(Number(n) / 1e6).toFixed(2)}m` : `€${Math.round(Number(n) / 1000)}k`;
const dateDisplay = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
const canonical = (name) => new Map([
  ['alashkert yerevan fc', 'Alashkert FC'], ['fc universitatea cluj', 'U Cluj'], ['universitatea cluj', 'U Cluj'],
  ['fc rapid 1923', 'FC Rapid'], ['sepsi osk sf gheorghe', 'Sepsi OSK'], ['ss lazio', 'Lazio'], ['us lecce', 'Lecce'],
]).get(String(name || '').toLowerCase()) || name;

async function getJson(url, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.json();
    } catch (error) { last = error; await sleep(600 * (i + 1)); }
  }
  throw last;
}

function matchMeta(gameId) {
  const row = [...matchesHtml.matchAll(/<tr\b[^>]*data-home-club-id="\d+"[^>]*>[\s\S]*?<\/tr>/g)]
    .map((m) => m[0]).find((item) => item.includes(`spielbericht/${gameId}`));
  if (!row) throw new Error(`Hiányzó meccssor: ${gameId}`);
  const cell = (label) => row.match(new RegExp(`<td\\b[^>]*data-label="${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([\\s\\S]*?)<\\/td>`, 'i'))?.[1] || '';
  const matchCell = cell('Mérkőzés / eredmény');
  return {
    gameId,
    url: matchCell.match(/href="([^"]+)"/)?.[1] || '',
    title: matchCell.match(/<strong>([^<]+)<\/strong>/)?.[1] || '',
    score: matchCell.match(/class="score"[^>]*>([^<]+)</)?.[1] || '',
    date: [...matchCell.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].at(-1)?.[0] || '',
    competition: strip(cell('Verseny')), season: strip(cell('Szezon')), round: strip(cell('Forduló / fázis / meccsnap')),
  };
}

const idsQuery = targets.map((item) => `ids[]=${item.id}`).join('&');
const playersJson = await getJson(`https://tmapi.transfermarkt.technology/players?${idsQuery}`);
const players = new Map((playersJson.data || []).map((player) => [String(player.id), player]));
const details = [];
for (const item of targets) {
  const performance = (await getJson(`https://tmapi.transfermarkt.technology/player/${item.id}/performance-game`))?.data?.performance || [];
  const graph = await getJson(`https://www.transfermarkt.com/ceapi/marketValueDevelopment/graph/${item.id}`);
  details.push({ item, performance, graph: graph.list || [] });
}
const clubIds = new Set();
for (const detail of details) {
  const player = players.get(String(detail.item.id));
  for (const assignment of player?.clubAssignments || []) if (assignment.type === 'current') clubIds.add(String(assignment.clubId));
  for (const row of detail.performance) {
    if (detail.item.seenGameIds.includes(String(row?.gameInformation?.gameId || ''))) {
      clubIds.add(String(row?.clubsInformation?.club?.clubId || ''));
      clubIds.add(String(row?.statistics?.generalStatistics?.primaryClubId || ''));
    }
  }
}
clubIds.delete('');
const clubs = new Map();
const clubList = [...clubIds];
for (let i = 0; i < clubList.length; i += 45) {
  const query = clubList.slice(i, i + 45).map((id) => `ids[]=${id}`).join('&');
  const json = await getJson(`https://tmapi.transfermarkt.technology/clubs?${query}`);
  for (const club of json.data || []) clubs.set(String(club.id), club.name);
}

const newRows = [];
const filterTeams = new Map();
for (const detail of details) {
  const player = players.get(String(detail.item.id));
  const current = player?.marketValueDetails?.current || {};
  const highest = player?.marketValueDetails?.highest || {};
  const assignment = (player?.clubAssignments || []).find((a) => a.type === 'current');
  const assignedName = clubs.get(String(assignment?.clubId || '')) || '';
  const special = String(assignedName).toLowerCase();
  const currentClub = special === 'retired' ? 'Retired' : special === 'without club' || !assignedName ? 'Free agent' : canonical(assignedName);
  const status = currentClub === 'Retired' ? 'retired' : currentClub === 'Free agent' ? 'free-agent' : 'active';
  const peakPoint = [...detail.graph].sort((a, b) => Number(b.y || 0) - Number(a.y || 0))[0] || {};
  const peakClub = canonical(peakPoint.verein || currentClub);
  const nationality = detail.item.seniorNationalTeams[0]?.name?.includes('Congo') ? 'Congo' : detail.item.seniorNationalTeams[0]?.name || '';
  const totalCaps = detail.item.seniorNationalTeams.reduce((sum, team) => sum + Number(team.caps || 0), 0);
  const nationalBadges = detail.item.seniorNationalTeams.map((team) => {
    const token = team.name.includes('Congo') ? 'congo' : team.name.toLowerCase().replace(/\s+/g, ' ');
    filterTeams.set(`name:${token}`, team.name.includes('Congo') ? 'Congo' : team.name);
    return `<span class="badge">${esc(team.name)} · ${Number(team.caps) || 0} meccs · ${Number(team.goals) || 0} gól</span>`;
  }).join(' ');
  const nationalTokens = [...filterTeams.keys()].filter((token) => detail.item.seniorNationalTeams.some((team) => token === `name:${team.name.includes('Congo') ? 'congo' : team.name.toLowerCase().replace(/\s+/g, ' ')}`));

  for (const gameId of detail.item.seenGameIds) {
    const meta = matchMeta(gameId);
    const perf = detail.performance.find((row) => String(row?.gameInformation?.gameId || '') === gameId);
    const isNational = Boolean(perf?.gameInformation?.isNationalGame);
    const seenClubId = String(perf?.clubsInformation?.club?.clubId || '');
    const primaryClubId = String(perf?.statistics?.generalStatistics?.primaryClubId || seenClubId);
    const seenClub = canonical(clubs.get(seenClubId) || meta.title.split(' - ')[0]);
    const clubAtMatch = canonical(clubs.get(isNational ? primaryClubId : seenClubId) || seenClub);
    const matchMs = Date.parse(`${meta.date}T23:59:59Z`);
    const history = detail.graph.map((point) => ({ ...point, ms: Number(point.x || 0) })).sort((a, b) => a.ms - b.ms);
    const mvAt = history.filter((point) => point.ms <= matchMs).at(-1) || history[0] || {};
    const name = player?.name || detail.item.slug.replace(/-/g, ' ');
    const open = `<tr data-player-id="${detail.item.id}" data-player="${esc(name.toLowerCase())}" data-season="${esc(meta.season)}" data-seen-club="${esc(seenClub)}" data-club-at-match="${esc(clubAtMatch)}" data-nationality="${esc(nationality)}" data-nationality-tokens="|${esc(nationality)}|" data-national-teams="|${esc(nationalTokens.join('|'))}|" data-total-apps="${totalCaps}" data-competition="${esc(meta.competition)}" data-round="${esc(meta.round)}" data-status="${status}" data-current-mv="${Number(current.value) || 0}" data-peak="${Number(highest.value) || Number(peakPoint.y) || 0}">`;
    newRows.push(`${open}
        <td data-label="Játékos"><a href="https://www.transfermarkt.com/${esc(detail.item.slug)}/profil/spieler/${detail.item.id}" target="_blank" rel="noopener"><strong>${esc(name)}</strong></a><span>ID: ${detail.item.id}</span></td>
        <td data-label="Nemzetiség"><strong>${esc(nationality)}</strong></td>
        <td data-label="Válogatott / meccs / gól">${nationalBadges}</td>
        <td data-label="Látott csapat"><strong>${esc(seenClub)}</strong></td>
        <td data-label="Látáskori klub"><strong>${esc(clubAtMatch)}</strong></td>
        <td data-label="Látáskori MV"><span class="value">${money(mvAt.y)}</span>${mvAt.datum_mw ? `<span>snapshot: ${esc(mvAt.datum_mw)}</span>` : ''}</td>
        <td data-label="Mostani klub / státusz"><strong>${esc(currentClub)}</strong></td>
        <td data-label="Jelenlegi MV"><span class="value">${money(current.value)}</span>${current.determined ? `<span>snapshot: ${dateDisplay(current.determined)}</span>` : ''}</td>
        <td data-label="All-time Peak MV"><span class="value">${money(highest.value || peakPoint.y)}</span>${highest.determined ? `<span>snapshot: ${dateDisplay(highest.determined)}</span>` : peakPoint.datum_mw ? `<span>snapshot: ${esc(peakPoint.datum_mw)}</span>` : ''}</td>
        <td data-label="Peak MV klub"><strong>${esc(peakClub)}</strong></td>
        <td class="match-cell" data-label="Látott meccs / eredmény"><a href="${esc(meta.url)}" target="_blank" rel="noopener">${esc(meta.title)}</a><span class="score">${esc(meta.score)}</span><span>${meta.date}</span></td>
        <td data-label="Verseny"><strong>${esc(meta.competition)}</strong></td><td data-label="Szezon"><strong>${esc(meta.season)}</strong></td><td data-label="Forduló / fázis / meccsnap"><strong>${esc(meta.round)}</strong></td>
      </tr>`);
  }
}

const tbody = capped.match(/(<tbody\b[^>]*id="results-body"[^>]*>)([\s\S]*?)(<\/tbody>)/i);
const rows = [...tbody[2].matchAll(/<tr\b[^>]*data-player-id="\d+"[^>]*>[\s\S]*?<\/tr>/g)].map((m) => m[0]).concat(newRows);
rows.sort((a, b) => Number(attr(rowOpen(b), 'data-peak')) - Number(attr(rowOpen(a), 'data-peak')) || Number(attr(rowOpen(b), 'data-total-apps')) - Number(attr(rowOpen(a), 'data-total-apps')) || attr(rowOpen(a), 'data-player').localeCompare(attr(rowOpen(b), 'data-player'), 'hu'));
capped = capped.replace(tbody[0], `${tbody[1]}\n${rows.join('\n')}\n${tbody[3]}`);
const unique = new Set(rows.map((row) => attr(rowOpen(row), 'data-player-id'))).size;
const capsById = new Map(rows.map((row) => [attr(rowOpen(row), 'data-player-id'), Number(attr(rowOpen(row), 'data-total-apps')) || 0]));
capped = capped.replace(/(<strong id="stat-players">)\d+/, `$1${unique}`).replace(/(<strong id="stat-rows">)\d+/, `$1${rows.length}`).replace(/(<strong id="stat-apps">)\d+/, `$1${[...capsById.values()].reduce((a, b) => a + b, 0)}`).replace(/(<div class="filter-summary" id="filter-summary">)\d+ játékos · \d+ meccssor/, `$1${unique} játékos · ${rows.length} meccssor`);
const multi = capped.match(/(<div class="multi-options">)([\s\S]*?)(<\/div>)/i);
if (multi) {
  const existingOptions = new Map([...multi[2].matchAll(/<label class="multi-option">[\s\S]*?value="([^"]+)"[\s\S]*?<span>(.*?)<\/span>[\s\S]*?<\/label>/gi)].map((m) => [m[1].replace(/&#039;/g, "'"), strip(m[2])]));
  for (const [token, label] of filterTeams) if (!existingOptions.has(token)) existingOptions.set(token, label);
  const body = [...existingOptions].sort((a, b) => a[1].localeCompare(b[1], 'hu')).map(([token, label]) => `<label class="multi-option"><input type="checkbox" value="${esc(token)}"><span>${esc(label)}</span></label>`).join('\n');
  capped = capped.replace(multi[0], `${multi[1]}\n${body}\n${multi[3]}`);
}
fs.writeFileSync(path.join(root, cappedFile), capped);
console.log(`Beillesztve: ${newRows.length} sor, ${targets.length} új felnőtt válogatott játékos.`);
