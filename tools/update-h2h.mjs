import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { addH2HFilter } from './h2h-export.mjs';
import { writeGenerated } from './write-generated.mjs';
const root = path.resolve(import.meta.dirname, '..');
for (const file of fs.readdirSync(root).filter(f => f.endsWith('.html'))) {
  const target = path.join(root, file), before = fs.readFileSync(target, 'utf8');
  const after = addH2HFilter(before);
  assert.equal(addH2HFilter(after), after, `${file}: H2H is idempotent`);
  assert.equal((after.match(/<tr\b/g) || []).length, (before.match(/<tr\b/g) || []).length, `${file}: rows preserved`);
  writeGenerated(target, after);
  console.log(file);
}
