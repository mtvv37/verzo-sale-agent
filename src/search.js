// Niche search via Serper.dev (Google search results API). Earlier attempts
// that didn't pan out: DuckDuckGo HTML scraping (blocked with 403 from
// cloud/datacenter IPs like Vercel's), Brave Search API (now requires a paid
// subscription plan even for the "free" credits), and Google Custom Search
// JSON API (requires a billing-enabled GCP project even under the free
// quota).
// Confirmed via a real search: passing a higher `num` doesn't actually get
// more than ~10 organic results per call — that's a hard cap (Serper's
// plan, or what Google itself returns per page), not something the `num`
// param can raise. The only way to get deeper is Google's own pagination —
// `page: 2`, `page: 3` — the same "next page" a human would click. Each
// page is a separate call (1 Serper credit each), so this multiplies both
// yield and cost per query; maxPages defaults to 2 (double both) rather
// than assuming more depth is free.
//
// Returns { candidates, rawCount } rather than a bare array — rawCount
// (Serper's raw organic result count across all pages fetched, before our
// own same-domain dedup) is surfaced up through runPipeline/sourceAndSend
// into the API response, so "why did this query only find N companies" is
// answerable directly from a GitHub Actions log instead of guessing.
async function searchNiche(query, { limit = 15, maxPages = 2 } = {}) {
  if (!process.env.SERPER_API_KEY) {
    throw new Error('SERPER_API_KEY must be set (see .env.example)');
  }

  const results = [];
  for (let page = 1; page <= maxPages && results.length < limit; page++) {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num: 10, page }),
    });

    if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`);

    const data = await res.json();
    const pageResults = (data.organic || [])
      .filter((r) => r.link && r.title)
      .map((r) => ({ title: r.title, url: r.link }));

    if (pageResults.length === 0) break; // no more pages — stop early, don't burn a credit for nothing
    results.push(...pageResults);
  }

  return { candidates: dedupeByDomain(results).slice(0, limit), rawCount: results.length };
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
