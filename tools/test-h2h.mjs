import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import '../tmgh-statistics-core.js';
const { chromium } = await import(process.env.TMGH_PLAYWRIGHT ? pathToFileURL(process.env.TMGH_PLAYWRIGHT).href : 'playwright');
const root = path.resolve(import.meta.dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'tools/seen-statistics.json'), 'utf8'));
const pair = { h2hA: '7769', h2hB: '6429', sort: 'apps' };
const fixtures = data.matches.filter(m => [m.home, m.away].includes(pair.h2hA) && [m.home, m.away].includes(pair.h2hB));
assert.ok(fixtures.some(m => m.home === pair.h2hA) && fixtures.some(m => m.home === pair.h2hB));
for (const mode of ['players', 'teams']) {
  const expected = TMGHStatistics.aggregate(data, mode, pair);
  assert.deepEqual(TMGHStatistics.aggregate(data, mode, { ...pair, h2hA: pair.h2hB, h2hB: pair.h2hA }), expected);
  assert.deepEqual(TMGHStatistics.aggregate(data, mode, { ...pair, h2hB: pair.h2hA }), []);
  assert.deepEqual(TMGHStatistics.aggregate(data, mode, { ...pair, match: data.matches.find(m => !fixtures.includes(m)).id }), []);
  assert.deepEqual(TMGHStatistics.aggregate(data, mode, { ...pair, h2hB: '' }), TMGHStatistics.aggregate(data, mode, { sort: 'apps' }));
}
const files = ['All Seen Matches.html', 'TOP 5 players Seen Live.html', 'Capped Players Seen Live.html', 'Euro-WC Players Seen Live.html', 'Romanian Club-National Players Seen Live.html', 'All Players Seen Live.html', 'Player Statistics.html', 'Team Statistics.html'];
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
  const target = path.resolve(root, rel);
  if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' })[path.extname(target)] || 'application/octet-stream');
  res.end(fs.readFileSync(target));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.TMGH_BROWSER_CHANNEL ? { channel: process.env.TMGH_BROWSER_CHANNEL } : {}) });
  const base = `http://127.0.0.1:${server.address().port}/`;
  for (const width of [1440, 390, 320]) for (const file of files) {
    const page = await browser.newPage({ viewport: { width, height: 950 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    await page.goto(base + encodeURIComponent(file));
    const initialOptions = await page.locator('#h2h-a option').count();
    await page.locator('#h2h-a-search').fill('cFr');
    assert.ok(await page.locator('#h2h-a option').count() < initialOptions);
    assert.ok((await page.locator('#h2h-a option').allTextContents()).slice(1).every(name => name.toLowerCase().includes('cfr')));
    await page.locator('#h2h-a').selectOption('7769');
    await page.locator('#h2h-a-search').fill('nincs_ilyen_csapat_123');
    assert.equal(await page.locator('#h2h-a').inputValue(), '7769', 'Gépelés nem módosíthatja a kijelölt csapatot');
    assert.match(await page.locator('#h2h-a-search-status').textContent(), /Nincs/);
    await page.locator('#h2h-a-search').fill('');
    assert.equal(await page.locator('#h2h-a option').count(), initialOptions);
    await page.locator('#h2h-b-search').fill('cluj');
    assert.ok((await page.locator('#h2h-b option').allTextContents()).slice(1).every(name => name.toLowerCase().includes('cluj')));
    await page.locator('#h2h-b-search').fill('');
    const mode = await page.locator('body').getAttribute('data-statistics-mode');
    const reset = page.locator('#reset, #filter-reset, #reset-filters');
    const expected = mode ? TMGHStatistics.aggregate(data, mode, pair) : await page.locator('tbody tr').evaluateAll(rows => rows.filter(r => [r.dataset.h2hHome, r.dataset.h2hAway].includes('7769') && [r.dataset.h2hHome, r.dataset.h2hAway].includes('6429')).length);
    const count = mode ? expected.length : expected;
    assert.ok(count > 0);
    if (mode) await page.locator('#sort').selectOption('apps');
    await page.locator('#h2h-a').selectOption(pair.h2hA);
    await page.locator('#h2h-b').selectOption(pair.h2hB);
    const paginated = await page.locator('[data-page-action="next"]').count() > 0;
    await page.waitForFunction(n => [...document.querySelectorAll('tbody tr')].filter(r => r.getBoundingClientRect().height).length === n, paginated ? Math.min(count, 50) : count);
    if (mode) {
      const shown = await page.locator('tbody tr:visible').first().getAttribute('data-stat-id');
      assert.equal(shown, expected[0].id);
      assert.equal(await page.locator('[data-metric="apps"]').first().textContent(), expected[0].apps.toLocaleString('hu-HU'));
    } else {
      assert.ok(await page.locator('tbody tr:visible').evaluateAll(rows => rows.every(r => [r.dataset.h2hHome, r.dataset.h2hAway].includes('7769') && [r.dataset.h2hHome, r.dataset.h2hAway].includes('6429'))));
      if (paginated && count > 50) {
        await page.locator('[data-page-action="next"]').first().click();
        await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].find(r => r.getBoundingClientRect().height)?.querySelector('.tmgh-rank')?.textContent === '#51');
      }
    }
    await page.locator('#h2h-b').selectOption('');
    await page.locator('#h2h-a').selectOption(pair.h2hB);
    await page.locator('#h2h-b').selectOption(pair.h2hA);
    await page.waitForFunction(n => [...document.querySelectorAll('tbody tr')].filter(r => r.getBoundingClientRect().height).length === n, paginated ? Math.min(count, 50) : count);
    const season = page.locator('#filter-season, #season-filter, #season');
    await season.selectOption('2026/27');
    const seasonCount = mode ? TMGHStatistics.aggregate(data, mode, { ...pair, season: '2026/27' }).length : await page.locator('tbody tr').evaluateAll(rows => rows.filter(r => r.dataset.season === '2026/27' && [r.dataset.h2hHome, r.dataset.h2hAway].includes('7769') && [r.dataset.h2hHome, r.dataset.h2hAway].includes('6429')).length);
    await page.waitForFunction(n => [...document.querySelectorAll('tbody tr')].filter(r => r.getBoundingClientRect().height).length === n, paginated ? Math.min(seasonCount, 50) : seasonCount);
    await page.locator('#h2h-b').selectOption(pair.h2hB);
    await page.waitForFunction(() => ![...document.querySelectorAll('tbody tr')].some(r => r.getBoundingClientRect().height));
    assert.match(await page.locator('#h2h-help').textContent(), /különböző/);
    await reset.click();
    assert.equal(await page.locator('#h2h-a').inputValue(), '');
    assert.equal(await page.locator('#h2h-b').inputValue(), '');
    assert.equal(await page.locator('#h2h-a-search').inputValue(), '');
    assert.equal(await page.locator('#h2h-b-search').inputValue(), '');
    await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some(r => r.getBoundingClientRect().height));
    const absent = await page.locator('#h2h-a option[value]:not([value=""])').evaluateAll(options => options.map(o => o.value).find(id => id !== '7769' && !document.querySelector(`tbody tr[data-h2h-home="7769"][data-h2h-away="${id}"],tbody tr[data-h2h-away="7769"][data-h2h-home="${id}"]`)));
    if (!mode && absent) {
      await page.locator('#h2h-a').selectOption('7769');
      await page.locator('#h2h-b').selectOption(absent);
      await page.waitForFunction(() => ![...document.querySelectorAll('tbody tr')].some(r => r.getBoundingClientRect().height));
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    for (const control of await page.locator('.tmgh-h2h select, .tmgh-h2h input').all()) {
      const box = await control.boundingBox();
      assert.ok(box.width > 150 && box.height >= 40, `${width}/${file}: H2H méret`);
    }
    assert.deepEqual(errors, []);
    if (file === 'All Seen Matches.html' && width !== 320) {
      await page.locator('.tmgh-h2h').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(root, 'tools/.cache/qa', `h2h-${width}.png`) });
    }
    console.log(`OK ${width}px: ${file}; H2H mindkét sorrendben, metszet, üres találat és reset`);
    await page.close();
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
