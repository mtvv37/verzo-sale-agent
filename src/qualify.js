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

async function qualifyLead({ domain, homepageText, teamMentions }) {
  const prompt = `${ICP}

---

Analyze this company as a potential VERZO prospect. Use only what's in the
extract below — never invent facts not present here.

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
