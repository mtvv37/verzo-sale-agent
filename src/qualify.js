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
or multinational chain/franchise (see "Digital signals (disqualifying)"
above)? Require CONCRETE evidence of real scale to disqualify on this
basis — a recognizable big-network brand, an explicit large headcount
("500+ collaborateurs"), dozens+ people visible on a team page, or clearly
high-volume/mass-market staffing. If yes, set disqualify_reason to name
what gave it away and skip scoring.

Do NOT disqualify for any of these alone: international partner/affiliate
offices mentioned, 2-4 offices in different French cities (normal growth
for an independent SME, not a chain), or confident marketing language
("rayonnement national", "leader régional", "depuis 20 ans") — that's
positioning copy, not proof of size. When genuinely unsure whether this is
a successful independent SME or a large network, do NOT disqualify — a
wrongly-rejected good lead is a worse outcome than one extra email to a
company that turns out to be too big.

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
