require('dotenv').config();
const express = require('express');
const { runPipeline } = require('./pipeline');
const { sendApproved } = require('./mailer');
const supabase = require('./lib/supabase');

const app = express();
app.use(express.json());

function requireSecret(req, res, next) {
  const provided = req.headers['x-verzo-secret'] || (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!process.env.VERZO_SECRET || provided !== process.env.VERZO_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

app.get('/health', (req, res) => {
  res.json({ status: 'VERZO sales agent is alive', ts: new Date().toISOString() });
});

// Manual trigger: POST /run { "query": "cabinet de recrutement Paris", "limit": 15 }
app.post('/run', requireSecret, async (req, res) => {
  const { query, limit } = req.body || {};
  if (!query) return res.status(400).json({ error: 'query required' });
  try {
    const results = await runPipeline(query, { limit });
    res.json({ ok: true, count: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Scheduled trigger (Vercel Cron auto-sends Authorization: Bearer <CRON_SECRET>
// when a CRON_SECRET env var is set on the project — see vercel.json and
// https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
// Cron requests can't carry a body, so the query comes from DEFAULT_NICHE_QUERY.
app.get('/cron/run', (req, res, next) => {
  const provided = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}, async (req, res) => {
  const query = process.env.DEFAULT_NICHE_QUERY;
  if (!query) return res.status(400).json({ error: 'DEFAULT_NICHE_QUERY not set' });
  try {
    const results = await runPipeline(query, { limit: 15 });
    res.json({ ok: true, count: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/leads', requireSecret, async (req, res) => {
  let q = supabase.from('leads').select('*').order('total_score', { ascending: false });
  if (req.query.status) q = q.eq('status', req.query.status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Human approval gate — nothing gets emailed until this is called for a lead.
app.post('/leads/:id/approve', requireSecret, async (req, res) => {
  const { error } = await supabase.from('leads').update({ approved: true }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.post('/send-approved', requireSecret, async (req, res) => {
  try {
    const result = await sendApproved();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;

if (require.main === module) {
  const port = process.env.PORT || 3001;
  app.listen(port, () => console.log(`[VERZO] listening on :${port}`));
}
