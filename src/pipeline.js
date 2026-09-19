const { searchNiche } = require('./search');
const { scrapeSite, extractDecisionMaker, guessEmailPatterns } = require('./scrape');
const { qualifyLead } = require('./qualify');
const { draftOutreach } = require('./draft');
const supabase = require('./lib/supabase');

const MIN_SCORE_FOR_OUTREACH = Number(process.env.MIN_SCORE_FOR_OUTREACH || 70);

// Companies Thomas has already personally approached (outside the
// automated pipeline) or otherwise wants never auto-contacted — checked
// before any other filter. Extend via the EXCLUDED_DOMAINS env var
// (comma-separated) for future additions without a code change.
const EXCLUDED_DOMAINS = [
  'execavenue.com', // already personally approached by Thomas
  'artelatum.com', // already personally approached by Thomas
  ...(process.env.EXCLUDED_DOMAINS || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean),
];

function matchesExcludedDomain(candidate) {
  try {
    const domain = new URL(candidate.url).hostname.toLowerCase();
    return EXCLUDED_DOMAINS.find((frag) => domain.includes(frag));
  } catch {
    return null;
  }
}

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

// Search results often surface listicles/directories/job boards ("Les 28
// meilleurs cabinets de recrutement à Nantes", Indeed job listing pages)
// instead of an actual company's own site — these aren't a company to
// pitch, so filter them out before wasting a scrape + Claude call on them.
const LISTICLE_TITLE_PATTERNS = [
  /\btop\s*\d+/i, /\bmeilleurs?\b/i, /\bclassement\b/i, /\bcomparatif\b/i,
  /\bpalmar[eè]s\b/i, /\bs[ée]lection\b/i, /\bannuaire\b/i,
  /\d+\s+(cabinets?|agences?)\b/i,
];

const DIRECTORY_DOMAINS = [
  'indeed.', 'welcometothejungle.', 'glassdoor.', 'linkedin.', 'monster.',
  'pagesjaunes.', 'societe.com', 'verif.com', 'infogreffe.', 'kompass.',
  'journaldunet.com', 'capital.fr', 'lefigaro.fr', 'lesechos.fr', 'wikipedia.',
];

function matchesListicleOrDirectory(candidate) {
  const titleMatch = LISTICLE_TITLE_PATTERNS.find((re) => re.test(candidate.title));
  if (titleMatch) return 'listicle/ranking title';

  try {
    const domain = new URL(candidate.url).hostname.toLowerCase();
    const domainMatch = DIRECTORY_DOMAINS.find((frag) => domain.includes(frag));
    if (domainMatch) return `directory/job board (${domainMatch})`;
  } catch {
    // fall through
  }

  return null;
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
      const excluded = matchesExcludedDomain(candidate);
      if (excluded) {
        results.push({ company: candidate.title, website: candidate.url, status: 'skipped', reason: `manually excluded (${excluded})` });
        continue;
      }

      const existing = existingByWebsite.get(candidate.url);
      if (existing) {
        results.push({ company: candidate.title, website: candidate.url, status: 'skipped', reason: `already in CRM (status: ${existing.status}, score: ${existing.total_score ?? 'n/a'})` });
        continue;
      }

      const networkMatch = matchesKnownLargeNetwork(candidate);
      if (networkMatch) {
        results.push({ company: candidate.title, website: candidate.url, status: 'disqualified', reason: `known large network (${networkMatch})` });
        continue;
      }

      const listicleMatch = matchesListicleOrDirectory(candidate);
      if (listicleMatch) {
        results.push({ company: candidate.title, website: candidate.url, status: 'disqualified', reason: listicleMatch });
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
    await saveLead({ candidate, scraped, qualification, status: 'DISQUALIFIED' });
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
    disqualify_reason: qualification.disqualify_reason || null,
    status,
    email_draft: draft ? `${draft.email_subject}\n\n${draft.email_body}` : null,
    linkedin_draft: draft ? draft.linkedin_message : null,
  };

  const { error } = await supabase.from('leads').upsert(row, { onConflict: 'website' });
  if (error) console.error('[VERZO] Failed to save lead:', candidate.url, error.message);
}

// "Qualifier quand même" (dashboard button) — Thomas overriding the score:
// drafts outreach for a lead that scored below MIN_SCORE_FOR_OUTREACH (or
// was otherwise left without a draft) using whatever was already captured
// about it, and marks it QUALIFIED + approved so it goes out through the
// normal send path without needing to also clear AUTO_SEND_MIN_SCORE.
async function qualifyLeadNow(id) {
  const { data: lead, error } = await supabase.from('leads').select('*').eq('id', id).single();
  if (error) throw error;
  if (!lead) throw new Error('lead not found');
  if (lead.email_draft) throw new Error('lead already has a draft');

  let domain;
  try {
    domain = new URL(lead.website).hostname.replace(/^www\./, '');
  } catch {
    domain = lead.website || '';
  }

  const draft = await draftOutreach({
    company: lead.company,
    domain,
    opportunity: lead.opportunity || '(revu et validé manuellement par Thomas malgré un score sous le seuil)',
    businessTrigger: lead.business_trigger,
    decisionMaker: lead.decision_maker,
    role: lead.role,
    emailGuessed: lead.email_guessed,
  });

  const { error: updateError } = await supabase
    .from('leads')
    .update({
      status: 'QUALIFIED',
      approved: true,
      email_draft: `${draft.email_subject}\n\n${draft.email_body}`,
      linkedin_draft: draft.linkedin_message,
    })
    .eq('id', id);
  if (updateError) throw updateError;

  return { id, company: lead.company, status: 'QUALIFIED' };
}

module.exports = { runPipeline, qualifyLeadNow };
