import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Isolated, ignored cache namespace; no network access or production cache edits.
process.env.TMGH_AS_OF = `test-freshness-${process.pid}-${Date.now()}`;
const { source, cacheDir } = await import('./source-cache.mjs');
const url = 'https://example.invalid/full-refresh-test';
const file = path.join(cacheDir, createHash('sha256').update(url).digest('hex') + '.json');
const originalFetch = globalThis.fetch;
let requests = 0;
globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ revision: ++requests }) });
try {
  assert.equal((await source(url)).revision, 1);
  assert.equal((await source(url)).revision, 1, 'Normál aznapi cache');
  fs.utimesSync(file, new Date('2000-01-01'), new Date('2000-01-01'));
  process.env.TMGH_REFRESH_SINCE = new Date(Date.now() - 1000).toISOString();
  assert.equal((await source(url)).revision, 2, 'Korábbi aznapi válasz is újralekérendő');
  assert.equal((await source(url)).revision, 2, 'Egy frissítési futáson belüli újrahasználat');
  assert.equal((await source(url, true, 1, { refresh: true })).revision, 3, 'Explicit friss lekérés');
  assert.equal(requests, 3);
  console.log('OK: teljes frissítés nem használ régebbi aznapi választ; ugyanazon futás friss válaszát újrahasználhatja.');
} finally {
  globalThis.fetch = originalFetch;
  delete process.env.TMGH_REFRESH_SINCE;
}
