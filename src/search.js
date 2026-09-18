// Niche search via the Brave Search API. Replaced an earlier DuckDuckGo
// HTML-scraping approach that DuckDuckGo blocks (HTTP 403) from cloud/
// datacenter IPs like Vercel's — Brave's API is meant for programmatic use
// so it doesn't hit that wall. Free tier: see .env.example for setup.
async function searchNiche(query, { limit = 15 } = {}) {
  if (!process.env.BRAVE_API_KEY) {
    throw new Error('BRAVE_API_KEY must be set (see .env.example)');
  }

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(limit, 20)}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': process.env.BRAVE_API_KEY,
    },
  });

  if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`);

  const data = await res.json();
  const results = (data.web?.results || [])
    .filter((r) => r.url && r.title)
    .map((r) => ({ title: r.title, url: r.url }));

  return dedupeByDomain(results).slice(0, limit);
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
