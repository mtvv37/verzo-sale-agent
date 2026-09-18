const Anthropic = require('@anthropic-ai/sdk');

// Lazy singleton — see src/lib/supabase.js for why this can't throw at
// module load time.
let client;

function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY must be set (see .env.example)');
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

module.exports = new Proxy({}, { get: (_, prop) => getClient()[prop] });
