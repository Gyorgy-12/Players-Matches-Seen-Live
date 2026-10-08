import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const AS_OF = process.env.TMGH_AS_OF || '2026-10-08';
export const cacheDir = path.join(import.meta.dirname, '.cache', AS_OF);
export async function source(url, json = true, attempts = 4) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, createHash('sha256').update(url).digest('hex') + (json ? '.json' : '.html'));
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, 'utf8');
    return json ? JSON.parse(text) : text;
  }
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: json ? 'application/json' : 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error(`${response.status}: ${url}`);
      const text = await response.text();
      const result = json ? JSON.parse(text) : text;
      if (json && result?.success === false) throw new Error(result.message || 'API error');
      fs.writeFileSync(file, text);
      return result;
    } catch (error) {
      last = error;
      await new Promise(resolve => setTimeout(resolve, 700 * (i + 1)));
    }
  }
  throw last;
}
