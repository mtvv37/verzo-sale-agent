const supabase = require('./lib/supabase');

// UTC midnight is a safe "start of day" boundary here even though the
// business day runs on Paris time: Paris is always ahead of UTC (+1/+2),
// so by the time this report fires (end of the Paris business day), UTC
// midnight already happened hours earlier — both calendars agree on "today"
// for the whole window this covers. Same convention as mailer.js's
// startOfToday(), kept separate here since the two aren't related calls.
function startOfTodayUTC() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// End-of-day recap (dashboard KPIs answer "what's the state now" — this
// answers "what happened today"), sent as a single ntfy push so Thomas
// doesn't have to open the dashboard to know whether the day was worth
// checking in on.
async function buildDailySummary() {
  const since = startOfTodayUTC();

  const { data: sourcedToday, error } = await supabase
    .from('leads')
    .select('company, status, total_score')
    .gte('created_at', since);
  if (error) throw error;

  const { count: contactedToday, error: contactError } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .gte('last_contact', since);
  if (contactError) throw contactError;

  const rows = sourcedToday || [];
  const sourced = rows.length;
  const qualified = rows.filter((l) => l.status === 'QUALIFIED').length;
  const disqualified = rows.filter((l) => l.status === 'DISQUALIFIED').length;

  const topOpportunities = rows
    .filter((l) => l.status === 'QUALIFIED')
    .sort((a, b) => (b.total_score ?? 0) - (a.total_score ?? 0))
    .slice(0, 5);

  const lines = [
    sourced
      ? `${sourced} candidats sourcés, ${qualified} qualifiés, ${disqualified} non retenus, ${contactedToday || 0} contacté(s).`
      : `Aucun candidat sourcé aujourd'hui. ${contactedToday || 0} contacté(s).`,
  ];
  if (topOpportunities.length) {
    lines.push('Top opportunités :');
    topOpportunities.forEach((l) => lines.push(`- ${l.company} (${l.total_score})`));
  }

  return { sourced, qualified, disqualified, contacted: contactedToday || 0, topOpportunities, text: lines.join('\n') };
}

module.exports = { buildDailySummary };
