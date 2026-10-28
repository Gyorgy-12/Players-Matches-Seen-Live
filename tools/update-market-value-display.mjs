import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { writeGenerated } from './write-generated.mjs';
import { formatMillions, normalizeMarketValueDisplay, restoreMarketValueDisplay } from './market-value-display.mjs';

for (const [input, output] of [[1, '€1.0m'], [4.56, '€4.6m'], [9.94, '€9.9m'], [9.96, '€10m'], [10, '€10m'], [28.63, '€29m'], [180, '€180m']]) assert.equal(formatMillions(input), output);
const root = path.resolve(import.meta.dirname, '..');
for (const file of fs.readdirSync(root).filter(f => f.endsWith('.html'))) {
  const target = path.join(root, file);
  const before = fs.readFileSync(target, 'utf8');
  const after = normalizeMarketValueDisplay(before);
  assert.equal(restoreMarketValueDisplay(after), restoreMarketValueDisplay(before), `${file}: only display may change`);
  assert.equal(normalizeMarketValueDisplay(after), after, `${file}: repeated formatting must be stable`);
  writeGenerated(target, after);
  console.log(`${file}: ${(after.match(/<!--tmgh-mv:/g) || []).length} million values formatted`);
}
