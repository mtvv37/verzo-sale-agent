# Sourcing prompt

Use this prompt (adapt the search criteria) to find new prospects.

---

Find [N] companies matching this profile: [describe industry, size, geography].

For each company, use web search to gather ONLY publicly verifiable information:
- Company name
- Website URL
- Industry
- Approximate employee count
- Country / HQ location

Do not invent or guess any field. If a fact cannot be verified, leave it blank
rather than filling it in.

Filter out companies that:
- have no real website
- are clearly too small (solo founder, no apparent revenue)
- are clearly too large / enterprise procurement-driven

Output a table of candidate companies, then hand the qualifying subset to the
qualification step (see `prompts/qualification.md`) before adding anything to
the CRM.
