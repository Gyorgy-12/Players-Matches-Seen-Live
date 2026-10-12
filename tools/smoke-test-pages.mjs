import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.TMGH_PLAYWRIGHT ? pathToFileURL(process.env.TMGH_PLAYWRIGHT).href : 'playwright');
const root = path.resolve(import.meta.dirname, '..');
// Check every row, including rows hidden by pagination: legacy wrappers and
// freshly imported cells must have identical semantic colors and value sizing.
const auditTableDesign = () => {
  const issues = [];
  const check = (el, expected) => {
    const actual = getComputedStyle(el);
    for (const [property, value] of Object.entries(expected)) if (actual[property] !== value) {
      issues.push(`${el.closest('td')?.dataset.label}/${el.textContent.trim().slice(0, 45)}: ${property}=${actual[property]}, expected ${value}`);
    }
  };
  const values = document.querySelectorAll('tbody td > .value, tbody td > .selected-metric, tbody td[data-label="Nézőszám"] > strong');
  for (const el of values) check(el, { color: 'rgb(124, 239, 208)', fontSize: '14px', fontWeight: '900', marginTop: '0px', lineHeight: '20.3px' });
  for (const el of document.querySelectorAll('tbody .tmgh-match-title')) check(el, { color: 'rgb(119, 220, 255)' });
  for (const el of document.querySelectorAll('tbody .score')) check(el, { color: el.classList.contains('tmgh-penalty-score') ? 'rgb(239, 231, 255)' : 'rgb(255, 230, 166)' });
  if (innerWidth > 720) for (const el of document.querySelectorAll('thead th')) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const style = getComputedStyle(el);
    if (range.getBoundingClientRect().width > el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) + 1) issues.push(`Levágott oszlopfejléc: ${el.textContent}`);
  }
  return { checked: values.length, issues: issues.slice(0, 20) };
};
async function assertTableDesign(page, context) {
  const audit = await page.evaluate(auditTableDesign);
  assert.ok(audit.checked > 0, `${context}: nincs ellenőrizhető kiemelt érték`);
  assert.deepEqual(audit.issues, [], `${context}: eltérő táblázatformázás`);
}
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
    ['All Seen Matches.html', '#teamSearch', 'U Cluj', '#season', 93],
    ['TOP 5 players Seen Live.html', '#filter-player', 'Stojilkovic', '#filter-season', 420],
    ['Capped Players Seen Live.html', '#filter-player', 'Morutan', '#filter-season', 1183],
    ['Euro-WC Players Seen Live.html', '#player-search', 'Jovo', '#season-filter', 283],
    ['Romanian Club-National Players Seen Live.html', '#q', 'Oucasse', '#season', 2520],
  ];
  for (const width of [1440, 820, 390]) {
    for (const [file, input, search, season, expectedRows] of cases) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
      await page.goto(base + encodeURIComponent(file), { waitUntil: 'load' });
      assert.equal(await page.locator('tbody tr').count(), expectedRows);
      await page.waitForFunction(() => !document.body.classList.contains('tmgh-paginated-pending'));
      await assertTableDesign(page, `${width}/${file}`);
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
      await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some(r => r.getBoundingClientRect().height && r.querySelector('a[href*="spielbericht/4914525"]')));
      const visible = await page.locator('tbody tr:visible').count();
      assert.ok(visible > 0 && (!paginated || visible <= 50));
      const newRow = page.locator('tbody tr:visible').filter({ has: page.locator('a[href*="spielbericht/4914525"]') });
      assert.ok(await newRow.count() > 0, `Új meccs kereshető: ${file}`);
      await assertTableDesign(page, `${width}/${file}/szűrve`);
      assert.deepEqual(errors, [], `${file}: böngészőhiba`);
      assert.ok(await page.locator('.tmgh-filter-jump').count() > 0);
      console.log(`OK ${width}px: ${file}; keresés: ${visible} találat`);
      await page.close();
    }
  }
  const qa = path.join(root, 'tools', '.cache', 'qa');
  fs.mkdirSync(qa, { recursive: true });
  const uiSnapshot = () => {
    const fields = {
      select: ['.filter-card select', ['fontFamily', 'fontSize', 'minHeight', 'borderRadius', 'backgroundColor', 'color']],
      title: ['.table-title', ['fontFamily', 'fontSize', 'padding', 'borderRadius']],
      row: ['tbody tr', ['display', 'borderRadius']],
      cell: ['tbody td', ['display', 'fontSize', 'padding', 'gridTemplateColumns']],
      header: ['thead', ['display']],
    };
    return Object.fromEntries(Object.entries(fields).map(([key, [selector, properties]]) => {
      const style = getComputedStyle(document.querySelector(selector));
      return [key, Object.fromEntries(properties.map(p => [p, p === 'gridTemplateColumns' && style.display !== 'grid' ? 'not-grid' : style[p]]))];
    }));
  };
  const referenceStyles = new Map();
  for (const width of [1440, 820, 720, 390, 320]) {
    const reference = await browser.newPage({ viewport: { width, height: 900 } });
    await reference.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    await reference.goto(base + encodeURIComponent('Capped Players Seen Live.html'));
    referenceStyles.set(width, await reference.evaluate(uiSnapshot));
    await reference.close();
  }
  for (const width of [1440, 820, 720, 390, 320]) for (const [file, mode] of [['Player Statistics.html', 'players'], ['Team Statistics.html', 'teams']]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    await page.goto(base + encodeURIComponent(file));
    assert.deepEqual(await page.evaluate(uiSnapshot), referenceStyles.get(width), `${width}/${mode}: közös megjelenés`);
    await assertTableDesign(page, `${width}/${mode}`);
    assert.equal(await page.locator('#statistics-rows tr').count(), 50);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}/${mode}: oldalszélesség`);
    for (const control of await page.locator('.filter-card input,.filter-card select').all()) {
      const box = await control.boundingBox();
      assert.ok(box.width > 150 && box.height >= 40, `${mode}: szűrőméret`);
    }
    assert.deepEqual(await page.locator('#page-size option').allTextContents(), ['50', '100', '200']);
    await page.locator('#page-size-bottom').selectOption('100');
    assert.equal(await page.locator('#page-size').inputValue(), '100');
    await page.locator('#page-size').selectOption('50');
    assert.equal(await page.locator('#page-size-bottom').inputValue(), '50');
    if (mode === 'players') {
      await page.locator('[data-page-action="next"]').first().click();
      assert.equal(await page.locator('[data-page-current]').first().textContent(), '2');
      await page.locator('[data-page-action="prev"]').first().click();
      assert.equal(await page.locator('[data-page-current]').first().textContent(), '1');
    } else assert.equal(await page.locator('[data-page-action="next"]').first().isDisabled(), true);
    await page.locator('#match').selectOption('4914525');
    await page.locator('#sort').selectOption('apps');
    await assertTableDesign(page, `${width}/${mode}/meccsszám szerinti kiemelés`);
    await page.locator('#page-size').selectOption('50');
    assert.equal(await page.locator('#statistics-rows tr').count(), mode === 'players' ? 30 : 2);
    const totals = await page.locator('[data-metric="goals"]').allTextContents();
    assert.equal(totals.reduce((n, t) => n + Number(t), 0), 7);
    await page.locator('#team').selectOption('6429');
    assert.equal(await page.locator('#statistics-rows tr').count(), mode === 'players' ? 15 : 1);
    assert.equal((await page.locator('[data-metric="goals"]').allTextContents()).reduce((n, t) => n + Number(t), 0), 3);
    await page.locator('#direction').selectOption('asc');
    if (mode === 'players') {
      await page.locator('#sort').selectOption('goals');
      assert.equal(await page.locator('[data-metric="goals"]').first().textContent(), '1');
      assert.equal(await page.locator('#statistics-rows tr').count(), 3);
      await page.locator('#sort').selectOption('red');
      assert.equal(await page.locator('#statistics-rows tr').count(), 0);
    }
    await page.locator('#reset').click();
    await page.locator('#query').fill(mode === 'players' ? 'siafa' : 'U Cluj');
    await page.locator('#sort').selectOption('apps');
    await page.waitForFunction(() => document.querySelectorAll('#statistics-rows tr').length === 1);
    assert.ok(Number(await page.locator('[data-metric="apps"]').textContent()) >= 2);
    await page.locator('#query').fill('biztosan_nincs_ilyen_12345');
    await page.locator('#empty').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#statistics-rows tr').count(), 0);
    await page.locator('#reset').click();
    await page.locator('#match').selectOption('4914525');
    await page.locator('#statistics-table').scrollIntoViewIfNeeded();
    if (width > 720) {
      await page.locator('.table-wrap').evaluate(el => el.scrollIntoView({ block: 'start' }));
      const box = await page.locator('.table-wrap').boundingBox();
      const x = box.x + Math.min(600, box.width - 60), y = box.y + 90;
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 250, y, { steps: 10 }); await page.mouse.up();
      assert.ok(await page.locator('.table-wrap').evaluate(el => el.scrollLeft >= Math.min(200, el.scrollWidth - el.clientWidth) - 1));
      assert.equal(await page.evaluate(() => getSelection().toString()), '');
      await page.locator('.table-wrap').evaluate(el => el.scrollLeft = 0);
    } else {
      await page.evaluate(() => window.scrollTo(0, document.getElementById('statistics-table').offsetTop));
      await page.waitForFunction(() => document.querySelector('.tmgh-filter-jump').classList.contains('is-visible'));
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.tmgh-filter-jump')).opacity) === 1);
      await page.screenshot({ path: path.join(qa, `${mode}-${width}-table.png`) });
      await page.locator('.tmgh-filter-jump').click();
      await page.waitForFunction(() => document.querySelector('.filter-card').getBoundingClientRect().top >= -3);
      if (width === 390) await page.screenshot({ path: path.join(qa, `${mode}-${width}-filters.png`) });
    }
    if (width === 1440) await page.screenshot({ path: path.join(qa, `${mode}-${width}-table.png`) });
    assert.deepEqual(errors, []);
    console.log(`OK ${width}px: ${file}; közös dizájn, újraszámolás, keresés, lapozás, rendezés, húzás/mobilugrás`);
    await page.close();
  }
  const hub = await browser.newPage();
  await hub.goto(base);
  const sourceCounts = ['Player Statistics.html', 'Team Statistics.html'].reduce((n, f) => n + Number(fs.readFileSync(path.join(root, f), 'utf8').match(/data-stat-count="(\d+)"/)[1]), 4499);
  assert.equal(Number((await hub.locator('.summary-card strong').last().textContent()).replace(/\s/g, '')), sourceCounts);
  assert.equal(await hub.locator('.nav-item').count(), 7);
  assert.equal(await hub.locator('.summary-card strong').first().textContent(), '7');
  for (const mode of ['playerstats', 'teamstats', 'matches']) {
    await hub.locator(`.nav-item[data-page="${mode}"]`).click();
    await hub.locator('.loader.hidden').waitFor({ state: 'attached' });
    assert.equal(await hub.locator('.page-frame.active').count(), 1);
  }
  console.log('OK: központ, hét mód és összesített számláló.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
