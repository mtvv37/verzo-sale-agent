// Niche search via Google Programmable Search Engine (Custom Search JSON
// API). Free tier: 100 queries/day, no billing required. Earlier attempts:
// DuckDuckGo HTML scraping (blocked with 403 from cloud/datacenter IPs like
// Vercel's) and Brave Search API (now requires a paid subscription plan,
// even for the "free" monthly credits).
async function searchNiche(query, { limit = 15 } = {}) {
  if (!process.env.GOOGLE_CSE_API_KEY || !process.env.GOOGLE_CSE_CX) {
    throw new Error('GOOGLE_CSE_API_KEY and GOOGLE_CSE_CX must be set (see .env.example)');
  }

  const results = [];
  let start = 1;

  // Google CSE returns at most 10 results per call and caps at 100 total
  // (start <= 91 for the last page of 10) — paginate until we hit `limit`.
  while (results.length < limit && start <= 91) {
    const num = Math.min(10, limit - results.length);
    const url = `https://www.googleapis.com/customsearch/v1?key=${process.env.GOOGLE_CSE_API_KEY}&cx=${process.env.GOOGLE_CSE_CX}&q=${encodeURIComponent(query)}&num=${num}&start=${start}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`);

    const data = await res.json();
    const items = data.items || [];
    items.forEach((item) => {
      if (item.link && item.title) results.push({ title: item.title, url: item.link });
    });

    if (items.length < num) break;
    start += num;
  }

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
