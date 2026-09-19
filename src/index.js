require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { runPipeline, qualifyLeadNow } = require('./pipeline');
const { sendQualifiedLeads, sendTestEmail, sendLeadNow, markBounced } = require('./mailer');
const { notify } = require('./notify');
const supabase = require('./lib/supabase');

const dashboardHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');

const app = express();
app.use(cors());
app.use(express.json());

// Mobile-friendly lead viewer. Not secret-gated at the route level (the page
// itself is static HTML) — it asks for VERZO_SECRET client-side and uses it
// to call /leads, same as any other client. Bookmark /dashboard?key=<secret>
// once (e.g. "Add to Home Screen") and it's remembered via localStorage.
app.get('/dashboard', (req, res) => {
  res.type('html').send(dashboardHtml);
});

function requireSecret(req, res, next) {
  const provided = req.headers['x-verzo-secret'] || (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!process.env.VERZO_SECRET || provided !== process.env.VERZO_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// Express doesn't catch rejected promises from async handlers on its own —
// an uncaught throw (e.g. a missing env var) turns into an unhandled
// rejection that crashes the whole serverless function, not just this
// request. Every async route goes through this.
function wrap(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      res.status(500).json({ error: err.message });
    });
  };
}

// Runs sourcing+qualification+drafting, then immediately attempts to send
// the result — auto-send picks up leads scoring >= AUTO_SEND_MIN_SCORE (see
// mailer.js), rate-capped per day. Send failures never fail the sourcing
// response (e.g. Gmail not configured yet is fine, sourcing still worked).
async function sourceAndSend(query, limit) {
  const { results, searchStats } = await runPipeline(query, { limit });
  let sendResult = { skipped_send: true };
  try {
    sendResult = await sendQualifiedLeads();
  } catch (err) {
    sendResult = { error: err.message };
  }

  const qualified = results.filter((r) => r.status === 'QUALIFIED').length;
  const sent = sendResult.sent || 0;
  await notify(
    'VERZO — recherche terminée',
    `"${query}" — ${results.length} candidats, ${qualified} qualifiés, ${sent} envoyé(s).`
  );

  return { results, sendResult, searchStats };
}

app.get('/health', (req, res) => {
  res.json({ status: 'VERZO sales agent is alive', ts: new Date().toISOString() });
});

// Manual trigger: POST /run { "query": "cabinet de recrutement Paris", "limit": 15 }
app.post('/run', requireSecret, wrap(async (req, res) => {
  const { query, limit } = req.body || {};
  if (!query) return res.status(400).json({ error: 'query required' });
  const { results, sendResult, searchStats } = await sourceAndSend(query, limit);
  res.json({ ok: true, count: results.length, results, send: sendResult, search: searchStats });
}));

// Scheduled trigger (Vercel Cron auto-sends Authorization: Bearer <CRON_SECRET>
// when a CRON_SECRET env var is set on the project — see vercel.json and
// https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
// Cron requests can't carry a body, so the query comes from DEFAULT_NICHE_QUERY.
// This is the fully unattended path: sourcing, qualification, drafting AND
// sending all happen here with no human step in between.
app.get('/cron/run', (req, res, next) => {
  const provided = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}, wrap(async (req, res) => {
  const query = pickNicheQuery();
  if (!query) return res.status(400).json({ error: 'DEFAULT_NICHE_QUERY or DEFAULT_NICHE_QUERIES not set' });
  // 30 not 15 — a repeated query string returns near-identical top results,
  // so most of a short list is duplicates already in the CRM within a day or
  // two. Pulling deeper into Serper's ranking per call surfaces candidates
  // that a shallower fetch would never reach before the query "runs dry".
  const { results, sendResult, searchStats } = await sourceAndSend(query, 30);
  res.json({ ok: true, query, count: results.length, results, send: sendResult, search: searchStats });
}));

// DEFAULT_NICHE_QUERIES (comma-separated, e.g. "cabinet de recrutement
// Lyon,cabinet de recrutement Bordeaux,...") lets the cron rotate across
// cities/niches instead of hammering the same query every run — both for
// volume (a single city runs out of new candidates fast) and to avoid
// over-fitting to Paris. Falls back to the older singular DEFAULT_NICHE_QUERY.
//
// Round-robin by hour, not random: each Vercel invocation is stateless (no
// memory of what the last run picked), so a random pick can — and did —
// land on the same query in back-to-back hours purely by chance, wasting a
// whole run on results already known to be duplicates. Deriving the index
// from the current UTC hour instead guarantees every entry gets used once
// before any repeat, no shared state needed.
function pickNicheQuery() {
  const list = (process.env.DEFAULT_NICHE_QUERIES || '')
    .split(',')
    .map((q) => q.trim())
    .filter(Boolean);
  if (list.length) {
    const hourIndex = Math.floor(Date.now() / 3600000);
    return list[hourIndex % list.length];
  }
  return process.env.DEFAULT_NICHE_QUERY || null;
}

app.get('/leads', requireSecret, wrap(async (req, res) => {
  let q = supabase.from('leads').select('*').order('total_score', { ascending: false });
  if (req.query.status) q = q.eq('status', req.query.status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}));

// Optional manual override for borderline leads (score < AUTO_SEND_MIN_SCORE)
// that you still want sent — not required for high-scoring leads, those go
// out automatically.
app.post('/leads/:id/approve', requireSecret, wrap(async (req, res) => {
  const { error } = await supabase.from('leads').update({ approved: true }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

app.post('/send-approved', requireSecret, wrap(async (req, res) => {
  const result = await sendQualifiedLeads();
  res.json({ ok: true, ...result });
}));

// "Envoyer maintenant" (dashboard button) — sends this one lead right away
// after personal review, bypassing the hourly/daily automation caps (see
// mailer.js sendLeadNow). Moves it straight to CONTACTED.
app.post('/leads/:id/send-now', requireSecret, wrap(async (req, res) => {
  const result = await sendLeadNow(req.params.id);
  res.json({ ok: true, ...result });
}));

// "Qualifier quand même" (dashboard button) — overrides a below-threshold
// score: drafts outreach now and marks the lead QUALIFIED. NOT auto-approved
// — sending still needs a separate deliberate click ("Envoyer maintenant"
// or "Approuver"), so drafting a lead never by itself makes it eligible
// for the next automated send pass.
app.post('/leads/:id/qualify-now', requireSecret, wrap(async (req, res) => {
  const result = await qualifyLeadNow(req.params.id);
  res.json({ ok: true, ...result });
}));

// "Email invalide (bounce)" (dashboard button, on a CONTACTED lead) — see
// mailer.js markBounced for why this is a manual flag rather than automated
// detection. Moves the lead to its own BOUNCED bucket, distinct from both
// "à contacter" and "non matchés".
app.post('/leads/:id/bounce', requireSecret, wrap(async (req, res) => {
  const result = await markBounced(req.params.id);
  res.json({ ok: true, ...result });
}));

// Manually set/correct a lead's email when scraping didn't find one (dashboard
// inline field) — marks it as confirmed (not guessed), since Thomas typed it.
app.post('/leads/:id/email', requireSecret, wrap(async (req, res) => {
  const { email } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'valid email required' });
  }
  const { error } = await supabase.from('leads').update({ email, email_guessed: false }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// Sends a real email through the real drafting path (AI draft or
// EMAIL_TEMPLATE_BODY, whichever is active) to any address — for previewing
// template/signature/styling changes. Never touches the CRM.
// POST /test-send { "email": "you@example.com", "company": "Test SARL" }
app.post('/test-send', requireSecret, wrap(async (req, res) => {
  const { email, company } = req.body || {};
  if (!email || !company) return res.status(400).json({ error: 'email and company required' });
  const result = await sendTestEmail({ to: email, company });
  res.json({ ok: true, ...result });
}));

module.exports = app;

if (require.main === module) {
  const port = process.env.PORT || 3001;
  app.listen(port, () => console.log(`[VERZO] listening on :${port}`));
}
