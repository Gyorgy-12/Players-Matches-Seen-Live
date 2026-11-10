// Display rounding only: keep the original amount in an invisible
// marker, so repeated builds never round the stored value a second time.
export function formatMillions(amount) {
  return `€${Number(amount).toFixed(2)}M`;
}

export function restoreMarketValueDisplay(html) {
  return html.replace(/<!--tmgh-mv:([\d.]+)([mk]?)-->€[\d.]+[mMkK]/g, (_, original, unit) => `€${original}${unit || 'm'}`);
}

export function normalizeMarketValueDisplay(html) {
  // Work on visible text only, never on attributes, embedded data or scripts.
  return restoreMarketValueDisplay(html).replace(/(<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<!--[^]*?-->|<[^>]*>)|([^<]+)/gi,
    (whole, markup, text) => markup || text.replace(/€(\d+(?:\.\d+)?)([mk])\b/g,
      (_, original, unit) => unit === 'm'
        ? `<!--tmgh-mv:${original}-->${formatMillions(original)}`
        : `<!--tmgh-mv:${original}k-->€${Number(original).toFixed(1)}K`));
}
