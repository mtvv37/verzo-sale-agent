const cheerio = require('cheerio');

const USER_AGENT = 'Mozilla/5.0 (compatible; VerzoSalesAgent/1.0)';

// Free, no-API-key niche search via DuckDuckGo's HTML endpoint. Less
// reliable than a paid search API (results can be sparse or occasionally
// blocked) — swap this out for SerpAPI/Google CSE later if volume needs it.
async function searchNiche(query, { limit = 15 } = {}) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`);

  const html = await res.text();
  const $ = cheerio.load(html);
  const results = [];

  $('.result__a').each((_, el) => {
    const href = $(el).attr('href');
    const title = $(el).text().trim();
    if (!href || !title) return;
    const cleanUrl = resolveDuckDuckGoUrl(href);
    if (cleanUrl) results.push({ title, url: cleanUrl });
  });

  return dedupeByDomain(results).slice(0, limit);
}

function resolveDuckDuckGoUrl(href) {
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    const target = u.searchParams.get('uddg');
    return target ? decodeURIComponent(target) : href.startsWith('http') ? href : null;
  } catch {
    return null;
  }
}

function dedupeByDomain(results) {
  const seen = new Set();
  return results.filter((r) => {
    try {
      const domain = new URL(r.url).hostname.replace(/^www\./, '');
      if (seen.has(domain)) return false;
      seen.add(domain);
      return true;
    } catch {
      return false;
    }
  });
}

module.exports = { searchNiche };
