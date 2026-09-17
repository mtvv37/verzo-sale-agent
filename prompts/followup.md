# Follow-up prompt

Run this daily against the CRM.

---

1. List every lead with status `CONTACTED` where `next_followup` is today or
   earlier, grouped by `followup_count` (day 4, day 8, etc.).

2. For each, check Gmail for any reply since `last_contact`.
   - If replied: classify the reply (interested / not interested / needs info /
     out of office / wrong person) and draft an appropriate response. Update
     status to `REPLIED` or `INTERESTED` as relevant. Do not send without
     approval.
   - If no reply: draft a short, non-pushy follow-up that adds new
     information or a different angle — never "just checking in" with no
     content. Increment `followup_count`, propose the next `next_followup`
     date.

3. Stop following up after 3 attempts with no reply — set status to `LOST`
   (cold, can be revisited later) rather than continuing indefinitely.

4. Output a daily summary:

   FOLLOW-UPS TODAY
   [count] leads
   Day X: [count] leads
   Day Y: [count] leads

Present all drafts for approval before anything is sent.
