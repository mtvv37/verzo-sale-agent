// Push notifications via ntfy.sh — free, no account, no app-side setup
// beyond installing the app and subscribing to a topic. A POST to
// https://ntfy.sh/<topic> is all it takes to push a notification to every
// device subscribed to that topic.
async function notify(title, message) {
  if (!process.env.NTFY_TOPIC) return; // not configured — silently skip
  try {
    await fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, {
      method: 'POST',
      headers: { Title: title, 'Content-Type': 'text/plain; charset=utf-8' },
      body: message,
    });
  } catch (err) {
    console.error('[VERZO] Failed to send ntfy notification:', err.message);
  }
}

module.exports = { notify };
