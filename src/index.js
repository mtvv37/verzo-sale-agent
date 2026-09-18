require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { runPipeline } = require('./pipeline');
const { sendQualifiedLeads } = require('./mailer');
const supabase = require('./lib/supabase');

const app = express();
app.use(cors());
app.use(express.json());

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
  const results = await runPipeline(query, { limit });
  let sendResult = { skipped_send: true };
  try {
    sendResult = await sendQualifiedLeads();
  } catch (err) {
    sendResult = { error: err.message };
  }
  return { results, sendResult };
}

app.get('/health', (req, res) => {
  res.json({ status: 'VERZO sales agent is alive', ts: new Date().toISOString() });
});

// Manual trigger: POST /run { "query": "cabinet de recrutement Paris", "limit": 15 }
app.post('/run', requireSecret, wrap(async (req, res) => {
  const { query, limit } = req.body || {};
  if (!query) return res.status(400).json({ error: 'query required' });
  const { results, sendResult } = await sourceAndSend(query, limit);
  res.json({ ok: true, count: results.length, results, send: sendResult });
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
  const query = process.env.DEFAULT_NICHE_QUERY;
  if (!query) return res.status(400).json({ error: 'DEFAULT_NICHE_QUERY not set' });
  const { results, sendResult } = await sourceAndSend(query, 15);
  res.json({ ok: true, count: results.length, results, send: sendResult });
}));

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

module.exports = app;

if (require.main === module) {
  const port = process.env.PORT || 3001;
  app.listen(port, () => console.log(`[VERZO] listening on :${port}`));
}
