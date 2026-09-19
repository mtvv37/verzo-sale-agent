const nodemailer = require('nodemailer');
const supabase = require('./lib/supabase');
const { draftOutreach } = require('./draft');

const AUTO_SEND_MIN_SCORE = Number(process.env.AUTO_SEND_MIN_SCORE || 85);
// Conservative warm-up defaults for a brand-new sending domain — ramp these
// up gradually via env vars, don't jump straight to full volume. See
// README "Montée en charge" for a suggested weekly schedule.
const DAILY_SEND_LIMIT = Number(process.env.DAILY_SEND_LIMIT || 25);
const HOURLY_SEND_LIMIT = Number(process.env.HOURLY_SEND_LIMIT || 5);

const DEFAULT_SIGNATURE = [
  'Thomas Metivier',
  'Fondateur & Développeur',
  'Tél : 06.40.98.32.91',
  'www.verzo.studio',
  '',
  '2 allée Ambroise Paré, 92000 Nanterre',
].join('\n');

const UNSUBSCRIBE_TEXT = 'VERZO Studio — si vous ne souhaitez plus recevoir ce type de message, répondez "STOP" et vous ne serez plus contacté(e).';

// Hard gate on every real send to a prospect — never weekends, never
// outside 8h-18h Paris time. This must NOT depend on trusting the caller
// (the GitHub Actions cron schedule, a manual test run, "Envoyer
// maintenant") — it's checked here, once, for every path that can put an
// email in a stranger's inbox. A Saturday manual test run sent 5 real
// emails before this existed; never again.
function isWithinSendingHours() {
  if (process.env.IGNORE_SENDING_HOURS === 'true') return true; // explicit escape hatch, not a default
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date());
  const weekday = parts.find((p) => p.type === 'weekday').value;
  const hour = Number(parts.find((p) => p.type === 'hour').value);
  return !['Sat', 'Sun'].includes(weekday) && hour >= 8 && hour < 18;
}

function getTransport() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error('SMTP_HOST, SMTP_USER and SMTP_PASS must be set (see .env.example)');
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465, // true for 465 (SSL), false for 587 (STARTTLS)
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Turns a plain-text paragraph into HTML: bare URLs become links, single
// line breaks become <br>.
function paragraphToHtml(paragraph) {
  const escaped = escapeHtml(paragraph).replace(/\n/g, '<br>');
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#f5a623;">$1</a>');
}

function renderHtml({ bodyText, signature, footerText }) {
  const bodyHtml = bodyText
    .split('\n\n')
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px;">${paragraphToHtml(p)}</p>`)
    .join('\n');

  const signatureHtml = signature
    ? `<p style="margin:24px 0 0; color:#4b5563; font-size:14px; line-height:1.5;">${paragraphToHtml(signature)}</p>`
    : '';

  return `<!DOCTYPE html>
<html><body style="margin:0; padding:0; background:#f4f4f5;">
<div style="max-width:560px; margin:0 auto; padding:32px 24px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; color:#18181b; font-size:15px; line-height:1.6; background:#ffffff;">
${bodyHtml}
${signatureHtml}
<hr style="border:none; border-top:1px solid #e4e4e7; margin:28px 0 12px;">
<p style="margin:0; color:#9ca3af; font-size:12px; line-height:1.5;">${escapeHtml(footerText)}</p>
</div>
</body></html>`;
}

// Builds the plain-text and HTML versions of a sent email from a drafted
// subject/body. A fixed template (EMAIL_TEMPLATE_BODY) is expected to
// include its own signature if it wants one — don't double it up with the
// auto one.
function assembleEmail({ subject, body }) {
  const includeSignature = !process.env.EMAIL_TEMPLATE_BODY;
  const signature = includeSignature ? (process.env.EMAIL_SIGNATURE || DEFAULT_SIGNATURE) : '';

  const text = [body, signature, `---\n${UNSUBSCRIBE_TEXT}`].filter(Boolean).join('\n\n');
  const html = renderHtml({ bodyText: body, signature, footerText: UNSUBSCRIBE_TEXT });

  return { subject, text, html };
}

function startOfToday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function startOfThisHour() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

async function countSentSince(iso) {
  const { count, error } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'CONTACTED')
    .gte('last_contact', iso);

  if (error) throw error;
  return count || 0;
}

// Sends leads that are either explicitly approved (POST /leads/:id/approve,
// for borderline scores) or score high enough for unattended auto-send
// (>= AUTO_SEND_MIN_SCORE — see CLAUDE.md "SENDING"). Rate-capped per day
// AND per hour (DAILY_SEND_LIMIT / HOURLY_SEND_LIMIT) to protect sender
// reputation — the hourly cap is what actually paces volume through the
// day when this runs on an hourly schedule; the daily cap is the backstop.
// Every email gets an opt-out footer regardless of what the draft contains.
async function sendQualifiedLeads() {
  if (!isWithinSendingHours()) {
    return { sent: 0, skipped: 0, reason: 'outside allowed sending hours (weekdays 8h-18h Paris)' };
  }

  const transport = getTransport();

  const [sentToday, sentThisHour] = await Promise.all([
    countSentSince(startOfToday()),
    countSentSince(startOfThisHour()),
  ]);
  const remainingQuota = Math.max(0, Math.min(DAILY_SEND_LIMIT - sentToday, HOURLY_SEND_LIMIT - sentThisHour));
  if (remainingQuota === 0) {
    const reason = sentToday >= DAILY_SEND_LIMIT ? `daily limit reached (${DAILY_SEND_LIMIT}/day)` : `hourly limit reached (${HOURLY_SEND_LIMIT}/h)`;
    return { sent: 0, skipped: 0, reason };
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

  let sent = 0;
  let skipped = 0;

  for (const lead of leads) {
    if (!lead.email || !lead.email_draft) {
      skipped += 1;
      continue;
    }
    await deliverLead(lead, transport);
    sent += 1;
  }

  return { sent, skipped };
}

// Sends the email + updates CRM status for exactly one lead. Shared by the
// batch auto-send loop above and sendLeadNow() below (the dashboard's
// "Envoyer maintenant" button) — a deliberate one-off human click bypasses
// the hourly/daily caps (those exist to guard unattended automation, not a
// single reviewed decision), but still gets the same footer/BCC/status update.
async function deliverLead(lead, transport) {
  const [subject, ...bodyParts] = lead.email_draft.split('\n\n');
  const email = assembleEmail({ subject: subject || `VERZO — ${lead.company}`, body: bodyParts.join('\n\n').trim() || subject });

  // Raw SMTP submission doesn't write to any "Sent" folder on its own —
  // BCC a copy to SENT_COPY_TO (or the sending mailbox itself) so sent
  // outreach is actually visible somewhere.
  const bcc = process.env.SENT_COPY_TO || process.env.SMTP_USER;
  await transport.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: lead.email, bcc, ...email });

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
}

// "Envoyer maintenant" — an explicit per-lead human decision, so it ignores
// the hourly/daily automation caps. Works on any lead with a draft and an
// email, not just QUALIFIED ones (e.g. a manually-approved lower-score lead).
async function sendLeadNow(id) {
  if (!isWithinSendingHours()) {
    throw new Error('outside allowed sending hours (weekdays 8h-18h Paris) — try again during business hours');
  }

  const transport = getTransport();
  const { data: lead, error } = await supabase.from('leads').select('*').eq('id', id).single();
  if (error) throw error;
  if (!lead) throw new Error('lead not found');
  if (!lead.email) throw new Error('lead has no email');
  if (!lead.email_draft) throw new Error('lead has no draft');
  if (lead.last_contact) throw new Error('lead already contacted');

  await deliverLead(lead, transport);
  return { sent: true, company: lead.company, email: lead.email };
}

// Sends a real test email through the real drafting path (AI or
// EMAIL_TEMPLATE_BODY, whichever is active) to an arbitrary address —
// never touches the CRM. For previewing what a template/signature/styling
// change actually looks like before it goes to a real prospect.
async function sendTestEmail({ to, company }) {
  const transport = getTransport();
  const draft = await draftOutreach({
    company,
    domain: 'example.com',
    opportunity: '(ceci est un envoi de test)',
    businessTrigger: '',
    decisionMaker: '',
    role: '',
  });

  const email = assembleEmail({ subject: `[TEST] ${draft.email_subject}`, body: draft.email_body });
  await transport.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, ...email });
  return { sent: true, subject: email.subject };
}

module.exports = { sendQualifiedLeads, sendTestEmail, sendLeadNow };
