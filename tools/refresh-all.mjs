import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { AS_OF } from './source-cache.mjs';
import { writeGenerated } from './write-generated.mjs';

const root = path.resolve(import.meta.dirname, '..');
const files = ['All Seen Matches.html', 'TOP 5 players Seen Live.html', 'Capped Players Seen Live.html', 'Euro-WC Players Seen Live.html', 'Romanian Club-National Players Seen Live.html', 'All Players Seen Live.html', 'Player Statistics.html', 'Team Statistics.html'];
const startedAt = new Date().toISOString();
const backupDir = path.join(import.meta.dirname, '.cache', 'full-refresh', startedAt.replace(/[:.]/g, '-'));
fs.mkdirSync(backupDir, { recursive: true });
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const before = new Map([...files, 'index.html', 'TM Groundhopping Hub.html'].map(file => {
  fs.copyFileSync(path.join(root, file), path.join(backupDir, file));
  return [file, read(file)];
}));
const attr = (row, key) => row.match(new RegExp(`\\b${key}="([^"]*)"`))?.[1] || '';
const gameId = row => row.match(/spielbericht\/(\d+)/)?.[1] || '';
const rows = html => [...html.matchAll(/<tr\b[^>]*data-(?:player-id|home-club-id)="\d+"[^>]*>[\s\S]*?<\/tr>/g)].map(m => m[0]);
const rowKey = row => `${attr(row, 'data-player-id')}|${attr(row, 'data-tournament')}|${gameId(row)}`;
const cells = row => Object.fromEntries([...row.matchAll(/<td\b[^>]*data-label="([^"]+)"[^>]*>([\s\S]*?)<\/td>/g)].map(m => [m[1], m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()]));
const currentFields = ['Mostani klub / státusz', 'Jelenlegi MV', 'All-time Peak MV', 'Peak MV klub', 'Top-5 liga/app', 'Válogatott / meccs / gól', 'Hazai jelenlegi MV', 'Vendég jelenlegi MV'];
const historicalFields = ['Látáskori MV', 'Látáskor MV', 'Tornakori MV', 'Tornakori klub', 'Hazai akkori MV', 'Vendég akkori MV', 'Meccsnapi összérték'];
const report = { asOf: AS_OF, startedAt, finishedAt: null, status: 'running', pages: {}, sourceCoverage: {}, historicalPolicy: 'Historical match/tournament values are preserved; current fields and recorded-match events are refreshed.', backupDirectory: path.relative(root, backupDir) };
const reportPath = path.join(import.meta.dirname, 'full-refresh-report.json');
function saveReport() { writeGenerated(reportPath, JSON.stringify(report, null, 2) + '\n'); }
async function run(file, ...args) {
  console.log(`\nTeljes frissítés: ${file}`);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(import.meta.dirname, file), ...args], { cwd: root, env: { ...process.env, TMGH_AS_OF: AS_OF, TMGH_REFRESH_SINCE: startedAt }, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${file}: ${code}`)));
  });
}
const chunks = ids => Array.from({ length: Math.ceil(ids.length / 45) }, (_, i) => ids.slice(i * 45, (i + 1) * 45));
function freshCache(url) {
  const filename = path.join(import.meta.dirname, '.cache', AS_OF, createHash('sha256').update(url).digest('hex') + '.json');
  assert.ok(fs.existsSync(filename) && fs.statSync(filename).mtimeMs >= Date.parse(startedAt), `Nem ebből a frissítésből származó válasz: ${url}`);
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}
try {
  saveReport();
  await run('refresh-current-data.mjs', '--fresh');
  await run('collect-seen-statistics.mjs');
  await run('build-all-players.mjs');
  // Reconcile eligibility with the rebuilt complete pool, including any
  // newly corrected historical appearance. Fresh responses are reused.
  await run('refresh-current-data.mjs');
  await run('build-statistics-pages.mjs');
  await run('reconcile-static-metadata.mjs');

  const statistics = JSON.parse(read('tools/seen-statistics.json'));
  const refresh = JSON.parse(read('tools/refresh-current-data-report.json'));
  const ids = [...new Set(files.slice(1, 6).flatMap(f => rows(read(f)).map(r => attr(r, 'data-player-id'))))].sort((a, b) => Number(a) - Number(b));
  const profiles = new Map(chunks(ids).flatMap(batch => freshCache(`https://tmapi.transfermarkt.technology/players?${batch.map(id => `ids[]=${id}`).join('&')}`).data).map(p => [String(p.id), p]));
  const national = ids.map(id => freshCache(`https://tmapi.transfermarkt.technology/player/${id}/national-career-history`).data);
  for (const id of ids) freshCache(`https://tmapi.transfermarkt.technology/player/${id}/performance-game`);
  const matchClubIds = [...new Set([...read(files[0]).matchAll(/data-(?:home|away)-club-id="(\d+)"/g)].map(m => m[1]))];
  const clubIds = [...new Set([...matchClubIds, ...[...profiles.values()].flatMap(p => p.clubAssignments.filter(a => a.type === 'current').map(a => String(a.clubId))), ...national.flatMap(n => n.clubIds.map(String))])].sort((a, b) => Number(a) - Number(b));
  for (const batch of chunks(clubIds)) freshCache(`https://tmapi.transfermarkt.technology/clubs?${batch.map(id => `ids[]=${id}`).join('&')}`);
  report.sourceCoverage = { profiles: profiles.size, nationalCareerHistories: national.length, performanceHistories: ids.length, clubsIncludingNationalTeams: clubIds.length, matchClubs: matchClubIds.length, matchEvents: statistics.matches.length, recordedAppearances: statistics.appearances.length, allCurrentSourcesFetchedAfter: startedAt, peakValidation: 'Every career maximum compared with the fresh profile; earliest peak date/club retain their verified historical source.', failures: refresh.failures };
  const beforeGames = rows(before.get(files[0])).map(gameId);
  assert.deepEqual(rows(read(files[0])).map(gameId), beforeGames, 'Nem kerülhet be új meccs vagy változhat a meccssorrend');
  for (const file of files) {
    const oldRows = new Map(rows(before.get(file)).map(r => [rowKey(r), r]));
    const newRows = rows(read(file));
    const newKeys = new Set(newRows.map(rowKey));
    const changed = Object.fromEntries(currentFields.map(f => [f, new Set()]));
    for (const row of newRows) {
      const old = oldRows.get(rowKey(row));
      if (!old) continue;
      const oldCells = cells(old), newCells = cells(row);
      for (const field of currentFields) if (oldCells[field] !== newCells[field]) changed[field].add(attr(row, 'data-player-id') || gameId(row));
      for (const field of historicalFields) assert.equal(newCells[field], oldCells[field], `${file}/${rowKey(row)}: történeti mező változott (${field})`);
    }
    report.pages[file] = { rows: newRows.length || Number(read(file).match(/data-stat-count="(\d+)"/)?.[1]), addedAppearanceRows: newRows.filter(r => !oldRows.has(rowKey(r))).length, removedAppearanceRows: [...oldRows.keys()].filter(k => !newKeys.has(k)).length, changedEntitiesByField: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, [...v]])), contentChanged: read(file) !== before.get(file) };
  }
  assert.equal(read('index.html'), read('TM Groundhopping Hub.html'), 'A két főoldal eltér');
  await run('test-current-refresh.mjs');
  await run('test-statistics.mjs');
  await run('validate-static-data.mjs');
  report.status = 'complete';
  report.finishedAt = new Date().toISOString();
  saveReport();
  console.log('Mind a nyolc fül teljes frissítése és forrásellenőrzése kész.', JSON.stringify(report.sourceCoverage));
} catch (error) {
  report.status = 'failed';
  report.finishedAt = new Date().toISOString();
  report.error = String(error?.stack || error);
  saveReport();
  throw error;
}
