const { createClient } = require('@supabase/supabase-js');

// Lazy singleton: the missing-env-var check only fires when a route actually
// touches Supabase, not at module load — otherwise one unset var crashes
// every route (including /health) at cold start on Vercel.
let client;

function getClient() {
  if (!client) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set (see .env.example)');
    }
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  }
  return client;
}

module.exports = new Proxy({}, { get: (_, prop) => getClient()[prop] });
