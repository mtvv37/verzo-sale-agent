const cheerio = require('cheerio');

const USER_AGENT = 'Mozilla/5.0 (compatible; VerzoSalesAgent/1.0)';

const CANDIDATE_PATHS = [
  '/',
  '/contact',
  '/contact-us',
  '/a-propos',
  '/about',
  '/equipe',
  '/team',
  '/qui-sommes-nous',
  '/mentions-legales',
  '/legal',
];

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const GENERIC_EMAIL_REGEX = /^(contact|info|hello|bonjour|admin|support|no-?reply|rh|recrutement)@/i;

const ROLE_WORDS = 'fondateur\\w*|founder|associ[ée]\\w*|partner|directeur\\w*|directrice\\w*|director|managing director|ceo|pr[ée]sidente?';

const NAME_ROLE_REGEX = new RegExp(
  `([A-ZÀ-Ý][a-zà-ÿ'-]+(?:\\s[A-ZÀ-Ý][a-zà-ÿ'-]+){1,2})\\s*[,\\-–:]\\s*(${ROLE_WORDS})`,
  'i'
);
const ROLE_NAME_REGEX = new RegExp(
  `(${ROLE_WORDS})\\s*[,\\-–:]\\s*([A-ZÀ-Ý][a-zà-ÿ'-]+(?:\\s[A-ZÀ-Ý][a-zà-ÿ'-]+){1,2})`,
  'i'
);

async function fetchPage(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function scrapeSite(baseUrl) {
  const origin = new URL(baseUrl).origin;
  const emails = new Set();
  let homepageText = '';
  const teamMentions = [];

  for (const path of CANDIDATE_PATHS) {
    const html = await fetchPage(origin + path);
    if (!html) continue;

    const $ = cheerio.load(html);
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    if (path === '/') homepageText = text.slice(0, 4000);

    (text.match(EMAIL_REGEX) || []).forEach((e) => emails.add(e.toLowerCase()));
    $('a[href^="mailto:"]').each((_, el) => {
      const addr = ($(el).attr('href') || '').replace('mailto:', '').split('?')[0].trim();
      if (addr) emails.add(addr.toLowerCase());
    });

    $('h1, h2, h3, h4, p, li, span, div').each((_, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (t.length > 5 && t.length < 150 && new RegExp(ROLE_WORDS, 'i').test(t)) {
        teamMentions.push(t);
      }
    });
  }

  const allEmails = [...emails];

  return {
    domain: new URL(baseUrl).hostname.replace(/^www\./, ''),
    emails: allEmails.filter((e) => !GENERIC_EMAIL_REGEX.test(e)),
    genericEmails: allEmails.filter((e) => GENERIC_EMAIL_REGEX.test(e)),
    teamMentions: [...new Set(teamMentions)].slice(0, 25),
    homepageText,
  };
}

function extractDecisionMaker(teamMentions) {
  for (const mention of teamMentions) {
    let m = mention.match(NAME_ROLE_REGEX);
    if (m) return { name: m[1].trim(), role: m[2].trim() };
    m = mention.match(ROLE_NAME_REGEX);
    if (m) return { name: m[2].trim(), role: m[1].trim() };
  }
  return null;
}

function guessEmailPatterns(fullName, domain) {
  const parts = fullName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return [];
  const first = parts[0];
  const last = parts[parts.length - 1];

  return [
    `${first}.${last}@${domain}`,
    `${first}${last}@${domain}`,
    `${first[0]}${last}@${domain}`,
    `${first}@${domain}`,
    `${first}-${last}@${domain}`,
  ];
}

module.exports = { scrapeSite, extractDecisionMaker, guessEmailPatterns };
