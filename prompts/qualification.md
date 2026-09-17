# Qualification prompt

Use this prompt for each candidate company found during sourcing.

---

For [company name] ([website URL]):

1. Open the website (browser tool) and analyze:
   - homepage clarity / positioning
   - UX and navigation
   - visual design quality relative to the company's apparent market position
   - mobile experience
   - calls to action / conversion paths
   - overall "digital opportunity" for a redesign or new build

2. Search for a business trigger (recent, verifiable, publicly reported):
   - repositioning / rebrand
   - new service or product launch
   - new market entry
   - funding round
   - new leadership hire (CEO/Partner/Managing Director)

3. Identify the most relevant decision maker per `CLAUDE.md` target roles.
   Only use information from LinkedIn or the company's own site. Do not
   guess an email address — only report one if found publicly (site,
   LinkedIn, press).

4. Score the lead 0-100 using `data/icp.md` as the qualification criteria
   (website opportunity, company quality, digital importance, purchasing
   potential, timing/trigger, accessibility of decision maker).

5. Output one row per company:

   company | website | decision_maker | role | linkedin | email |
   website_score | business_trigger | opportunity | total_score

Only companies scoring above 75 move to `prompts/personalization.md`.
Everything else gets added to the CRM with status `NEW` (not `QUALIFIED`)
so it isn't lost, but is not actioned further right now.
