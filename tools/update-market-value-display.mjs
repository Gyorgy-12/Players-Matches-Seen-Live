import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { writeGenerated } from './write-generated.mjs';
import { formatMillions, normalizeMarketValueDisplay, restoreMarketValueDisplay } from './market-value-display.mjs';

for (const [input, output] of [[1, '€1.00M'], [6.5, '€6.50M'], [9.96, '€9.96M'], [10, '€10.00M'], [28.63, '€28.63M'], [180, '€180.00M']]) assert.equal(formatMillions(input), output);
const sample = normalizeMarketValueDisplay('<td>€900k €6.5m €250.25k</td>');
assert.match(sample, /€900\.0K .*€6\.50M .*€250\.3K/);
assert.equal(restoreMarketValueDisplay(sample), '<td>€900k €6.5m €250.25k</td>');
const root = path.resolve(import.meta.dirname, '..');
for (const file of fs.readdirSync(root).filter(f => f.endsWith('.html'))) {
  const target = path.join(root, file);
  const before = fs.readFileSync(target, 'utf8');
  const after = normalizeMarketValueDisplay(before);
  assert.equal(restoreMarketValueDisplay(after), restoreMarketValueDisplay(before), `${file}: only display may change`);
  assert.equal(normalizeMarketValueDisplay(after), after, `${file}: repeated formatting must be stable`);
  writeGenerated(target, after);
  console.log(`${file}: ${(after.match(/<!--tmgh-mv:/g) || []).length} market values formatted`);
}
