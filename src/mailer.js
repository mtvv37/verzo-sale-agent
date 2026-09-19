const nodemailer = require('nodemailer');
const supabase = require('./lib/supabase');

const AUTO_SEND_MIN_SCORE = Number(process.env.AUTO_SEND_MIN_SCORE || 85);
const DAILY_SEND_LIMIT = Number(process.env.DAILY_SEND_LIMIT || 10);

const DEFAULT_SIGNATURE = [
  'Thomas Metivier',
  'Fondateur & Développeur',
  'Tél : 06.40.98.32.91',
  'www.verzo.studio',
  '',
  '2 allée Ambroise Paré, 92000 Nanterre',
].join('\n');

function signatureBlock() {
  return `\n\n${process.env.EMAIL_SIGNATURE || DEFAULT_SIGNATURE}`;
}

function unsubscribeFooter() {
  return '\n\n---\nVERZO Studio — si vous ne souhaitez plus recevoir ce type de message, répondez "STOP" et vous ne serez plus contacté(e).';
}

function startOfToday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function countSentToday() {
  const { count, error } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'CONTACTED')
    .gte('last_contact', startOfToday());

  if (error) throw error;
  return count || 0;
}

// Sends leads that are either explicitly approved (POST /leads/:id/approve,
// for borderline scores) or score high enough for unattended auto-send
// (>= AUTO_SEND_MIN_SCORE — see CLAUDE.md "SENDING"). Rate-capped per day
// (DAILY_SEND_LIMIT) to protect sender reputation, and every email gets an
// opt-out footer appended regardless of what the draft already contains.
async function sendQualifiedLeads() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error('SMTP_HOST, SMTP_USER and SMTP_PASS must be set (see .env.example)');
  }

  const alreadySentToday = await countSentToday();
  const remainingQuota = Math.max(0, DAILY_SEND_LIMIT - alreadySentToday);
  if (remainingQuota === 0) {
    return { sent: 0, skipped: 0, reason: `daily limit reached (${DAILY_SEND_LIMIT}/day)` };
  }

  const { data: leads, error } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'QUALIFIED')
    .is('last_contact', null)
    .or(`approved.eq.true,total_score.gte.${AUTO_SEND_MIN_SCORE}`)
    .order('total_score', { ascending: false })
    .limit(remainingQuota);

  if (error) throw error;
  if (!leads?.length) return { sent: 0, skipped: 0 };

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465, // true for 465 (SSL), false for 587 (STARTTLS)
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  let sent = 0;
  let skipped = 0;

  for (const lead of leads) {
    if (!lead.email || !lead.email_draft) {
      skipped += 1;
      continue;
    }

    const [subject, ...bodyParts] = lead.email_draft.split('\n\n');
    // A fixed template (EMAIL_TEMPLATE_BODY) is expected to include its own
    // signature if it wants one — don't double it up with the auto one.
    const signature = process.env.EMAIL_TEMPLATE_BODY ? '' : signatureBlock();
    const body = (bodyParts.join('\n\n').trim() || subject) + signature + unsubscribeFooter();

    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
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

module.exports = { sendQualifiedLeads };
