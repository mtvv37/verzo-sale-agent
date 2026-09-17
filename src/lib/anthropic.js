const Anthropic = require('@anthropic-ai/sdk');

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY must be set (see .env.example)');
}

module.exports = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
