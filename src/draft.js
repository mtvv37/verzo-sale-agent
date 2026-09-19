const anthropic = require('./lib/anthropic');

function extractJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`Could not parse JSON from model response: ${raw.slice(0, 300)}`);
  }
}

// Fills {{placeholders}} in a fixed template with real values instead of
// generating fresh copy — used when EMAIL_TEMPLATE_BODY is set (see
// .env.example). Cheaper, predictable, and no risk of the model drifting
// off-brand; costs the personalization an AI draft would add.
function fillTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

function templateOutreach({ company, domain, opportunity, businessTrigger, decisionMaker, role }) {
  const vars = {
    company,
    domain,
    opportunity: opportunity || '',
    business_trigger: businessTrigger || '',
    decision_maker: decisionMaker || '',
    role: role || '',
  };

  return {
    email_subject: fillTemplate(process.env.EMAIL_TEMPLATE_SUBJECT || `VERZO — ${company}`, vars),
    email_body: fillTemplate(process.env.EMAIL_TEMPLATE_BODY, vars),
    linkedin_message: process.env.LINKEDIN_TEMPLATE ? fillTemplate(process.env.LINKEDIN_TEMPLATE, vars) : '',
  };
}

async function draftOutreach({ company, domain, opportunity, businessTrigger, decisionMaker, role, emailGuessed }) {
  if (process.env.EMAIL_TEMPLATE_BODY) {
    return templateOutreach({ company, domain, opportunity, businessTrigger, decisionMaker, role });
  }

  const prompt = `Draft outbound outreach for VERZO Studio (positioning: "Ideas In. Products Out." —
a digital product studio, not a traditional web agency).

Prospect: ${company} (${domain})
Decision maker: ${decisionMaker || 'unknown — address generically but professionally, no fake name'} (${role || 'unknown role'})
Opportunity identified: ${opportunity}
Business trigger: ${businessTrigger || '(none identified — do not fabricate one)'}
${emailGuessed ? 'Note: the email address for this contact is a guess, not confirmed — keep the message professional enough to land fine even if it reaches someone else at the company.' : ''}

Rules:
- Exactly one concrete observation about the company, no generic opener.
- Never claim results VERZO has not demonstrated. Never exaggerate.
- Email under 120 words. LinkedIn message under 60 words.
- End with a low-friction call to action (e.g. "ça vaut 15 minutes d'appel ?").
- Write in French.

Return ONLY a JSON object, no prose, no markdown fences:
{"email_subject": "...", "email_body": "...", "linkedin_message": "..."}`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });

  return extractJson(message.content[0].text.trim());
}

module.exports = { draftOutreach };
