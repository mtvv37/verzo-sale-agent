// Push notifications via ntfy.sh — free, no account, no app-side setup
// beyond installing the app and subscribing to a topic. A POST to
// https://ntfy.sh/<topic> is all it takes to push a notification to every
// device subscribed to that topic.
// fetch() only rejects on a network-level failure — an HTTP error response
// from ntfy.sh (rate limit, transient 5xx) resolves normally and was
// previously swallowed with zero trace, which is exactly how a notification
// could silently go missing with nothing in the logs to explain it. One
// retry covers the transient case; either way, a failure is now logged.
async function notify(title, message, attempt = 1) {
  if (!process.env.NTFY_TOPIC) return; // not configured — silently skip
  try {
    const res = await fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, {
      method: 'POST',
      headers: { Title: title, 'Content-Type': 'text/plain; charset=utf-8' },
      body: message,
    });
    if (!res.ok) throw new Error(`ntfy.sh returned HTTP ${res.status}`);
  } catch (err) {
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 1000));
      return notify(title, message, attempt + 1);
    }
    console.error('[VERZO] Failed to send ntfy notification:', err.message);
  }
}

module.exports = { notify };
