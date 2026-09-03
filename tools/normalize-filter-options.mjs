import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SEASON_SELECT_IDS = new Set(['season', 'filter-season', 'season-filter']);
const ALPHABETICAL_SELECT_IDS = new Set([
  'team',
  'stadium',
  'country',
  'competition',
  'filter-seen-club',
  'filter-nationality',
  'filter-competition',
  'club-filter',
  'nationality-filter',
  'nationality',
  'club',
  'round',
]);

const collator = new Intl.Collator('hu', {
  sensitivity: 'base',
  numeric: true,
  ignorePunctuation: true,
});

function decodeLabel(value) {
  let text = String(value ?? '').replace(/<[^>]+>/g, ' ');
  for (let pass = 0; pass < 3; pass += 1) {
    const decoded = text
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#(?:0*39);|&#x27;/gi, "'")
      .replace(/&nbsp;/gi, ' ');
    if (decoded === text) break;
    text = decoded;
  }
  return text.replace(/\s+/g, ' ').trim();
}

function selectId(attributes) {
  return attributes.match(/\bid="([^"]+)"/i)?.[1] || '';
}

function optionValue(option) {
  return option.match(/\bvalue="([^"]*)"/i)?.[1] || '';
}

function seasonKey(label) {
  const match = label.match(/^(\d{4})(?:\/(\d{2}|\d{4}))?$/);
  if (!match) return Number.NEGATIVE_INFINITY;
  const start = Number(match[1]);
  const end = match[2]
    ? Number(match[2].length === 2 ? `${match[1].slice(0, 2)}${match[2]}` : match[2])
    : 0;
  return start * 10000 + end;
}

function isUnknown(option, label) {
  return /(?:^|[_-])unknown(?:$|[_-])/i.test(optionValue(option)) || /^Ismeretlen\b/i.test(label);
}

export function normalizeFilterOptionOrder(html) {
  return html.replace(/(<select\b([^>]*)>)([\s\S]*?)(<\/select>)/gi, (whole, open, attributes, body, close) => {
    const id = selectId(attributes);
    const isSeason = SEASON_SELECT_IDS.has(id);
    const isAlphabetical = ALPHABETICAL_SELECT_IDS.has(id);
    if (!isSeason && !isAlphabetical) return whole;

    // A többszöri statikus exportból maradt duplán kódolt aposztrófokat is
    // ugyanarra a HTML-entitásra hozzuk, hogy a felirat és a szűrőérték egyezzen.
    body = body.replace(/&(?:amp;)+#(?:0*39);/gi, '&#039;');

    const options = [...body.matchAll(/<option\b[^>]*>[\s\S]*?<\/option>/gi)].map((match) => match[0]);
    if (options.length < 3) return whole;

    // A gyűjtőelem (Minden/Összes) mindig legfelül marad.
    const first = options.shift();
    options.sort((left, right) => {
      const leftLabel = decodeLabel(left);
      const rightLabel = decodeLabel(right);
      if (isSeason) {
        const bySeason = seasonKey(rightLabel) - seasonKey(leftLabel);
        return bySeason || collator.compare(leftLabel, rightLabel);
      }
      const unknownOrder = Number(isUnknown(left, leftLabel)) - Number(isUnknown(right, rightLabel));
      return unknownOrder || collator.compare(leftLabel, rightLabel);
    });

    return `${open}${first}${options.join('')}${close}`;
  });
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const root = path.resolve(import.meta.dirname, '..');
  const files = [
    'All Seen Matches.html',
    'TOP 5 players Seen Live.html',
    'Capped Players Seen Live.html',
    'Euro-WC Players Seen Live.html',
    'Romanian Club-National Players Seen Live.html',
  ];
  for (const file of files) {
    const fullPath = path.join(root, file);
    const original = fs.readFileSync(fullPath, 'utf8');
    const normalized = normalizeFilterOptionOrder(original);
    fs.writeFileSync(fullPath, normalized, 'utf8');
    console.log(`Rendezve: ${file}`);
  }
}
