import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.TMGH_PLAYWRIGHT ? pathToFileURL(process.env.TMGH_PLAYWRIGHT).href : 'playwright');
const root = path.resolve(import.meta.dirname, '..');
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.TMGH_BROWSER_CHANNEL ? { channel: process.env.TMGH_BROWSER_CHANNEL } : {}) });
  const base = `http://127.0.0.1:${server.address().port}/`;
  const cases = [
    ['All Seen Matches.html', '#teamSearch', 'CFR Cluj', '#season', 92],
    ['TOP 5 players Seen Live.html', '#filter-player', 'Omrani', '#filter-season', 415],
    ['Capped Players Seen Live.html', '#filter-player', 'Gelashvili', '#filter-season', 1169],
    ['Euro-WC Players Seen Live.html', '#player-search', 'Jovo', '#season-filter', 281],
    ['Romanian Club-National Players Seen Live.html', '#q', 'Ervin Omic', '#season', 2490],
  ];
  for (const width of [1440, 390]) {
    for (const [file, input, search, season, expectedRows] of cases) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
      await page.goto(base + encodeURIComponent(file), { waitUntil: 'load' });
      assert.equal(await page.locator('tbody tr').count(), expectedRows);
      await page.waitForFunction(() => !document.body.classList.contains('tmgh-paginated-pending'));
      assert.deepEqual(errors, [], `${file}: betöltési hiba`);
      const paginated = await page.locator('[data-page-action="next"]').count() > 0;
      if (paginated) {
        assert.equal(await page.locator('tbody tr:visible').count(), 50);
        const next = page.locator('[data-page-action="next"]').first();
        await next.click();
        assert.equal(await page.locator('[data-page-current]').first().textContent(), '2');
      }
      await page.locator(input).fill(search);
      await page.locator(season).selectOption('2026/27');
      await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some(r => r.getBoundingClientRect().height && r.querySelector('a[href*="spielbericht/4914561"]')));
      const visible = await page.locator('tbody tr:visible').count();
      assert.ok(visible > 0 && (!paginated || visible <= 50));
      const newRow = page.locator('tbody tr:visible').filter({ has: page.locator('a[href*="spielbericht/4914561"]') });
      assert.ok(await newRow.count() > 0, `Új meccs kereshető: ${file}`);
      assert.deepEqual(errors, [], `${file}: böngészőhiba`);
      assert.ok(await page.locator('.tmgh-filter-jump').count() > 0);
      console.log(`OK ${width}px: ${file}; keresés: ${visible} találat`);
      await page.close();
    }
  }
  const hub = await browser.newPage();
  await hub.goto(base);
  assert.match(await hub.locator('.summary-card').last().textContent(), /4\s447/);
  assert.equal(await hub.locator('.nav-item').count(), 5);
  console.log('OK: központ, öt mód és összesített számláló.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
