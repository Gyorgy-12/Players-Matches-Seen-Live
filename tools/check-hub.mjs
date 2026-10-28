import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const hub = read('index.html');
assert.equal(hub, read('TM Groundhopping Hub.html'), 'A főoldal és a központ menüje eltér. Futtasd: node tools/reconcile-static-metadata.mjs');
const pages = [...hub.matchAll(/\{ id:'([^']+)'[^\n]*meta:'([\d\s]+) [^']+', file:'([^']+)'/g)];
assert.equal(pages.length, 8, 'Nyolc menüpont szükséges');
let total = 0;
for (const [, id, label, file] of pages) {
  const html = read(file);
  const count = id.endsWith('stats') ? Number(html.match(/data-stat-count="(\d+)"/)[1]) : [...html.matchAll(id === 'matches' ? /<tr\b[^>]*data-home-club-id="\d+"/g : /<tr\b[^>]*data-player-id="\d+"/g)].length;
  assert.equal(Number(label.replace(/\s/g, '')), count, `${id}: elavult menüszámláló`);
  total += count;
}
assert.match(hub, new RegExp(`<span>Oldalak</span><strong>${pages.length}</strong>`));
assert.ok(hub.includes(total.toLocaleString('hu-HU', { useGrouping: 'always' })));
console.log('OK: nyolc menüpont, egyező főoldalak és friss számlálók.');
