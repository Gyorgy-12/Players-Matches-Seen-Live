// Display rounding only: keep the original million amount in an invisible
// marker, so repeated builds never round the stored value a second time.
export function formatMillions(amount) {
  const n = Number(amount);
  const rounded = Number(n.toFixed(n < 10 ? 1 : 0));
  return `€${rounded.toFixed(rounded < 10 ? 1 : 0)}m`;
}

export function restoreMarketValueDisplay(html) {
  return html.replace(/<!--tmgh-mv:([\d.]+)-->€[\d.]+m/g, (_, original) => `€${original}m`);
}

export function normalizeMarketValueDisplay(html) {
  // Work on visible text only, never on attributes, embedded data or scripts.
  return restoreMarketValueDisplay(html).replace(/(<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<!--[^]*?-->|<[^>]*>)|([^<]+)/gi,
    (whole, markup, text) => markup || text.replace(/€(\d+(?:\.\d+)?)m\b/g,
      (_, original) => `<!--tmgh-mv:${original}-->${formatMillions(original)}`));
}
