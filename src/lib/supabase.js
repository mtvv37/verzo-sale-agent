const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set (see .env.example)');
}

module.exports = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
