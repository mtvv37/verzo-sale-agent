# Personalization prompt

Use this prompt only for leads scoring above 75 in qualification.

---

For [company name], draft one outreach email and one LinkedIn message.

Requirements:
- Must reference the specific business_trigger and opportunity identified
  during qualification — no generic opener.
- Must contain exactly one concrete observation about the company (something
  a human clearly looked at, not a template variable).
- Must never claim results VERZO has not demonstrated.
- Must never exaggerate the scope of the problem found on their site.
- Tone: direct, confident, short. No corporate filler.
- Length: email under 120 words. LinkedIn message under 60 words.
- End with a low-friction call to action (e.g. "worth a 15-minute call?"),
  not a hard sell.

Output both drafts, save them to the lead's CRM record (`email_draft`,
`linkedin_draft`), and set status to `QUALIFIED`.

Do NOT send anything. Flag the drafts for human approval per `CLAUDE.md`.
