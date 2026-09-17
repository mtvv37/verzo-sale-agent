const { searchNiche } = require('./search');
const { scrapeSite, extractDecisionMaker, guessEmailPatterns } = require('./scrape');
const { qualifyLead } = require('./qualify');
const { draftOutreach } = require('./draft');
const supabase = require('./lib/supabase');

const MIN_SCORE_FOR_OUTREACH = 75;

async function runPipeline(query, { limit = 15 } = {}) {
  const candidates = await searchNiche(query, { limit });
  const results = [];

  for (const candidate of candidates) {
    try {
      results.push(await processCandidate(candidate));
    } catch (err) {
      results.push({ company: candidate.title, website: candidate.url, status: 'error', error: err.message });
    }
  }

  return results;
}

async function processCandidate(candidate) {
  const scraped = await scrapeSite(candidate.url);
  const qualification = await qualifyLead(scraped);

  if (qualification.disqualify_reason) {
    await saveLead({ candidate, scraped, qualification, status: 'NEW' });
    return { company: candidate.title, website: candidate.url, status: 'disqualified', reason: qualification.disqualify_reason };
  }

  const decisionMaker = extractDecisionMaker(scraped.teamMentions);
  let email = scraped.emails[0] || null;
  let emailGuessed = false;

  if (!email && decisionMaker) {
    const guesses = guessEmailPatterns(decisionMaker.name, scraped.domain);
    email = guesses[0] || null;
    emailGuessed = Boolean(email);
  }
  if (!email) email = scraped.genericEmails[0] || null;

  let draft = null;
  let status = 'NEW';

  if (qualification.total_score >= MIN_SCORE_FOR_OUTREACH) {
    draft = await draftOutreach({
      company: candidate.title,
      domain: scraped.domain,
      opportunity: qualification.opportunity,
      businessTrigger: qualification.business_trigger,
      decisionMaker: decisionMaker?.name,
      role: decisionMaker?.role,
      emailGuessed,
    });
    status = 'QUALIFIED';
  }

  await saveLead({ candidate, scraped, qualification, decisionMaker, email, emailGuessed, draft, status });

  return { company: candidate.title, website: candidate.url, status, score: qualification.total_score };
}

async function saveLead({ candidate, scraped, qualification, decisionMaker, email, emailGuessed, draft, status }) {
  const row = {
    company: candidate.title,
    website: candidate.url,
    decision_maker: decisionMaker?.name || null,
    role: decisionMaker?.role || null,
    email: email || null,
    email_guessed: Boolean(emailGuessed),
    website_score: qualification.website_score,
    business_trigger: qualification.business_trigger || null,
    opportunity: qualification.opportunity || null,
    total_score: qualification.total_score,
    status,
    email_draft: draft ? `${draft.email_subject}\n\n${draft.email_body}` : null,
    linkedin_draft: draft ? draft.linkedin_message : null,
  };

  const { error } = await supabase.from('leads').upsert(row, { onConflict: 'website' });
  if (error) console.error('[VERZO] Failed to save lead:', candidate.url, error.message);
}

module.exports = { runPipeline };
