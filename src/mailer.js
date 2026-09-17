const nodemailer = require('nodemailer');
const supabase = require('./lib/supabase');

// Sends only leads that are QUALIFIED, approved=true (set via POST
// /leads/:id/approve or directly in Supabase), and not already contacted.
// This is the one step in the pipeline that requires an explicit human
// approval per lead before anything goes out — see CLAUDE.md "HARD RULE".
async function sendApproved() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD must be set (see .env.example)');
  }

  const { data: leads, error } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'QUALIFIED')
    .eq('approved', true)
    .is('last_contact', null);

  if (error) throw error;
  if (!leads?.length) return { sent: 0, skipped: 0 };

  const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });

  let sent = 0;
  let skipped = 0;

  for (const lead of leads) {
    if (!lead.email || !lead.email_draft) {
      skipped += 1;
      continue;
    }

    const [subject, ...bodyParts] = lead.email_draft.split('\n\n');
    const body = bodyParts.join('\n\n').trim() || subject;

    await transport.sendMail({
      from: process.env.GMAIL_USER,
      to: lead.email,
      subject: subject || `VERZO — ${lead.company}`,
      text: body,
    });

    const nextFollowup = new Date();
    nextFollowup.setDate(nextFollowup.getDate() + 4);

    await supabase
      .from('leads')
      .update({
        status: 'CONTACTED',
        last_contact: new Date().toISOString(),
        next_followup: nextFollowup.toISOString(),
        followup_count: 1,
      })
      .eq('id', lead.id);

    sent += 1;
  }

  return { sent, skipped };
}

module.exports = { sendApproved };
