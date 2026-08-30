import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const playerFiles = ['TOP 5 players Seen Live.html', 'Capped Players Seen Live.html', 'Euro-WC Players Seen Live.html', 'Romanian Club-National Players Seen Live.html'];
const known = new Set(playerFiles.flatMap((file) => [...fs.readFileSync(path.join(root, file), 'utf8').matchAll(/data-player-id="(\d+)"/g)].map((m) => m[1])));
const matchHtml = fs.readFileSync(path.join(root, 'All Seen Matches.html'), 'utf8');
const matchIds = [...new Set([...matchHtml.matchAll(/spielbericht\/(\d+)/g)].map((m) => m[1]))];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(url, json = false, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: json ? 'application/json' : 'text/html', 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en-US,en;q=0.9' } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return json ? response.json() : response.text();
    } catch (error) {
      last = error;
      await sleep(600 * (i + 1));
    }
  }
  throw last;
}

async function mapLimit(items, limit, fn, label) {
  const out = new Array(items.length);
  let next = 0; let done = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try { out[index] = await fn(items[index]); } catch (error) { out[index] = { error: String(error?.message || error) }; }
      done += 1;
      if (done % 20 === 0 || done === items.length) console.log(`${label}: ${done}/${items.length}`);
    }
  }));
  return out;
}

console.log(`Meglévő pool: ${known.size}; változatlan meccsek: ${matchIds.length}`);
const lineupPages = await mapLimit(matchIds, 8, async (gameId) => ({ gameId, html: await get(`https://www.transfermarkt.com/-/aufstellung/spielbericht/${gameId}`) }), 'Keretoldalak');
const candidates = new Map();
for (const page of lineupPages) {
  if (!page?.html) continue;
  for (const m of page.html.matchAll(/href="\/([^"/]+)\/profil\/spieler\/(\d+)"/g)) {
    if (!candidates.has(m[2])) candidates.set(m[2], { id: m[2], slug: m[1] });
  }
}
const unknown = [...candidates.values()].filter((item) => !known.has(item.id));
console.log(`Keretoldali jelöltek: ${candidates.size}; eddig teljesen hiányzó: ${unknown.length}`);

const matchSet = new Set(matchIds);
const perf = await mapLimit(unknown, 10, async (item) => {
  const json = await get(`https://tmapi.transfermarkt.technology/player/${item.id}/performance-game`, true);
  const rows = json?.data?.performance || [];
  const seen = rows.filter((row) => {
    const gameId = String(row?.gameInformation?.gameId || '');
    const minutes = Number(row?.statistics?.playingTimeStatistics?.playedMinutes) || 0;
    const state = String(row?.statistics?.generalStatistics?.participationState || '').toLowerCase();
    return matchSet.has(gameId) && (state === 'played' || minutes > 0);
  });
  const top = rows.filter((row) => ['GB1', 'ES1', 'IT1', 'L1', 'FR1'].includes(String(row?.gameInformation?.competitionId || '')) &&
    !row?.gameInformation?.isNationalGame &&
    (String(row?.statistics?.generalStatistics?.participationState || '').toLowerCase() === 'played' || Number(row?.statistics?.playingTimeStatistics?.playedMinutes) > 0));
  return { ...item, seenGameIds: seen.map((row) => String(row.gameInformation.gameId)), top5Apps: top.length };
}, 'Hiányzó jelöltek pályára lépése');
const actual = perf.filter((item) => item && !item.error && item.seenGameIds.length);

const national = await mapLimit(actual, 10, async (item) => {
  const json = await get(`https://tmapi.transfermarkt.technology/player/${item.id}/national-career-history`, true);
  return { ...item, nationalHistory: json?.data?.history || [], nationalClubIds: json?.data?.clubIds || [] };
}, 'Hiányzó játékosok válogatottsága');
const clubIds = [...new Set(national.flatMap((item) => item.nationalClubIds || []))];
const clubs = new Map();
for (let i = 0; i < clubIds.length; i += 45) {
  const query = clubIds.slice(i, i + 45).map((id) => `ids[]=${id}`).join('&');
  const json = await get(`https://tmapi.transfermarkt.technology/clubs?${query}`, true);
  for (const club of json?.data || []) clubs.set(String(club.id), club.name);
}
const result = national.map((item) => {
  const senior = (item.nationalHistory || []).filter((entry) => Number(entry.gamesPlayed || 0) > 0 && !/\b(?:u\s?1[56789]|u\s?2[013]|under[- ]?(?:17|18|19|20|21|23)|olympic|b team|ii|a2)\b/i.test(clubs.get(String(entry.clubId)) || ''));
  return { id: item.id, slug: item.slug, seenGameIds: item.seenGameIds, top5Apps: item.top5Apps, seniorNationalTeams: senior.map((entry) => ({ name: clubs.get(String(entry.clubId)) || entry.clubId, caps: entry.gamesPlayed, goals: entry.goalsScored })) };
});
const report = { knownPlayers: known.size, matchIds: matchIds.length, lineupCandidates: candidates.size, previouslyUnlistedActualPlayers: result.length, eligible: result.filter((item) => item.top5Apps || item.seniorNationalTeams.length) };
fs.writeFileSync(path.join(root, 'tools', 'unlisted-seen-player-audit.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
