import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Explicit historical reuse. Never copy an older source into a newer dated
// cache or describe it as freshly downloaded.
const root = path.join(import.meta.dirname, '.cache');
const dates = fs.readdirSync(root).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
const entries = new Map();
export function archivedSource(url, json = true, notAfter = '9999-12-31') {
  const name = createHash('sha256').update(url).digest('hex') + (json ? '.json' : '.html');
  for (const date of dates.filter(d => d <= notAfter)) {
    if (!entries.has(date)) entries.set(date, new Set(fs.readdirSync(path.join(root, date))));
    if (!entries.get(date).has(name)) continue;
    const file = path.join(root, date, name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (!text || /awsWafCookieDomainList|verify that you're not a robot/.test(text)) continue;
    try { return { date, data: json ? JSON.parse(text) : text }; } catch { /* Ignore corrupt cache. */ }
  }
  return null;
}
