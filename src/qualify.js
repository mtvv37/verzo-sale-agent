const fs = require('fs');
const path = require('path');
const anthropic = require('./lib/anthropic');

const ICP = fs.readFileSync(path.join(__dirname, '..', 'data', 'icp.md'), 'utf8');

function extractJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`Could not parse JSON from model response: ${raw.slice(0, 300)}`);
  }
}

async function qualifyLead({ domain, homepageText, teamMentions, companyName }) {
  const prompt = `${ICP}

---

Analyze this company as a potential VERZO prospect. Use only what's in the
extract below — never invent facts not present here.

Before scoring anything else, check specifically: is this a large national
or multinational chain/franchise — multiple offices under the same legal
entity/group, a recognizable big-network brand, high-volume/temp staffing
language, or a large team at the primary office itself (see "Digital
signals (disqualifying)" above)? If yes, set disqualify_reason to name what
gave it away and skip scoring.

Do NOT disqualify just because international partner offices are mentioned.
A small founder-led team (a handful of consultants, named individually) that
belongs to an affiliate/partner network abroad is still an independent
boutique — common in executive search, where firms cross-refer work through
separately-owned partner firms rather than operating shared branches. Judge
by the team size and ownership structure at the office being evaluated, not
by how many cities its network claims to reach.

Company name (from search result): ${companyName || '(unknown)'}
Domain: ${domain}
Homepage text (raw extract, may be noisy): ${homepageText.slice(0, 3000) || '(no homepage text found)'}
Team/role mentions found on the site: ${teamMentions.join(' | ') || '(none found)'}

Return ONLY a JSON object, no prose, no markdown fences, with this exact shape:
{"total_score": <0-100 integer>, "website_score": <0-100 integer>, "opportunity": "<one short sentence>", "business_trigger": "<one short sentence, or empty string if none found>", "disqualify_reason": "<empty string, or a short reason if this is clearly not a fit>"}`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });

  return extractJson(message.content[0].text.trim());
}

module.exports = { qualifyLead };
