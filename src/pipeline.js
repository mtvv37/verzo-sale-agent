const { searchNiche } = require('./search');
const { scrapeSite, extractDecisionMaker, guessEmailPatterns } = require('./scrape');
const { qualifyLead } = require('./qualify');
const { draftOutreach } = require('./draft');
const supabase = require('./lib/supabase');

const MIN_SCORE_FOR_OUTREACH = 75;

// Cheap pre-filter for obviously-out-of-scope candidates (large national/
// multinational networks) — skips scraping + a Claude call entirely for
// known cases. Anything not on this list still goes through qualifyLead,
// which is instructed (via data/icp.md) to disqualify large networks it
// recognizes from the scraped content even if the brand isn't listed here.
const KNOWN_LARGE_NETWORKS = [
  'michael page', 'robert walters', 'randstad', 'hays', 'adecco', 'manpower',
  'lhh', 'pagegroup', 'spring', 'morgan philips', 'fed group', 'expectra',
  'kelly services', 'proman', 'synergie', 'crit', 'actual',
];

// Domain fragments for the same brands — catches results whose page title
// is generic (e.g. "Cabinet de recrutement à Paris") and doesn't mention
// the brand name, which the title-only check above misses.
const KNOWN_LARGE_NETWORK_DOMAINS = [
  'michaelpage', 'robertwalters', 'randstad', 'hays.', 'adecco', 'manpower',
  'lhh.com', 'pagegroup', 'spring.fr', 'morganphilips', 'fedgroup', 'fedwork',
  'expectra', 'kellyservices', 'proman', 'synergie', 'crit-job', 'actual.fr',
];

function matchesKnownLargeNetwork(candidate) {
  const title = candidate.title.toLowerCase();
  const titleMatch = KNOWN_LARGE_NETWORKS.find((brand) => title.includes(brand));
  if (titleMatch) return titleMatch;

  try {
    const domain = new URL(candidate.url).hostname.toLowerCase();
    return KNOWN_LARGE_NETWORK_DOMAINS.find((frag) => domain.includes(frag));
  } catch {
    return null;
  }
}

async function runPipeline(query, { limit = 15 } = {}) {
  const candidates = await searchNiche(query, { limit });
  const results = [];

  // Different search queries often resurface the same companies. Re-scraping
  // and re-qualifying (Claude calls) a website we've already processed wastes
  // time/cost — and worse, re-saving it would silently overwrite a lead's
  // real status (e.g. CONTACTED reverted back to QUALIFIED, risking a
  // duplicate auto-send later). So: skip anything already in the CRM.
  const existingByWebsite = await fetchExistingLeads(candidates.map((c) => c.url));

  for (const candidate of candidates) {
    try {
      const existing = existingByWebsite.get(candidate.url);
      if (existing) {
        results.push({ company: candidate.title, website: candidate.url, status: 'skipped', reason: `already in CRM (status: ${existing.status}, score: ${existing.total_score ?? 'n/a'})` });
        continue;
      }

      const match = matchesKnownLargeNetwork(candidate);
      if (match) {
        results.push({ company: candidate.title, website: candidate.url, status: 'disqualified', reason: `known large network (${match})` });
        continue;
      }
      results.push(await processCandidate(candidate));
    } catch (err) {
      results.push({ company: candidate.title, website: candidate.url, status: 'error', error: err.message });
    }
  }

  return results;
}

async function fetchExistingLeads(websites) {
  if (!websites.length) return new Map();
  const { data, error } = await supabase.from('leads').select('website, status, total_score').in('website', websites);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.website, row]));
}

async function processCandidate(candidate) {
  const scraped = await scrapeSite(candidate.url);
  const qualification = await qualifyLead({ ...scraped, companyName: candidate.title });

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
