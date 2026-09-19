// Niche search via Serper.dev (Google search results API). Earlier attempts
// that didn't pan out: DuckDuckGo HTML scraping (blocked with 403 from
// cloud/datacenter IPs like Vercel's), Brave Search API (now requires a paid
// subscription plan even for the "free" credits), and Google Custom Search
// JSON API (requires a billing-enabled GCP project even under the free
// quota).
async function searchNiche(query, { limit = 15 } = {}) {
  if (!process.env.SERPER_API_KEY) {
    throw new Error('SERPER_API_KEY must be set (see .env.example)');
  }

  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, num: Math.min(limit, 100) }),
  });

  if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`);

  const data = await res.json();
  const results = (data.organic || [])
    .filter((r) => r.link && r.title)
    .map((r) => ({ title: r.title, url: r.link }));

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
