# GDPR Compliance Proof Plan

Goal: make LLM Gateway demonstrably GDPR-compliant to EU prospects, procurement teams, and security reviewers — and turn that proof into a marketing asset that converts EU traffic.

## Premise

"Proving GDPR" splits into two layers. You cannot ship layer 2 honestly without layer 1.

1. **Operational reality** — the things we must actually do (legal basis, DPA, SCCs, sub-processor management, DSR handling, breach process, retention, RoPA, DPO/EU rep).
2. **Provable surface** — the artifacts a procurement reviewer expects to find on our website and product (DPA download, sub-processor page, security page, privacy controls in-product, signed DPA flow).

This plan covers both, prioritized so the trust page can launch as soon as the operational foundation underneath each claim is real.

## What we already have

- `apps/ui/src/content/legal/privacy.md` — privacy policy at `/legal/privacy`
- `apps/ui/src/content/legal/terms.md` — terms at `/legal/terms`
- Configurable data retention (metadata-only vs full payload) — `apps/docs/content/features/data-retention.mdx`
- BYOK mode (customer's own provider keys, reduces our data exposure)
- Audit log infrastructure — `ee/audit`
- `/reliability` page (uptime/latency)
- `/enterprise` page

## What's missing (the proof gap)

- No `/trust` or `/security` hub
- No public sub-processor list
- No downloadable DPA / self-serve DPA signing
- No EU data residency commitment or region selector
- No DSR (access/export/delete) self-serve flows surfaced to end users
- No cookie consent banner that meets EU ePrivacy
- Privacy policy is generic; lacks Article 13/14 specifics (legal basis per processing purpose, retention periods, DPO contact, EU rep, transfer mechanisms)
- No content targeting "GDPR + LLM" search demand

---

## Layer 1 — Operational foundation (the actual work)

These are non-negotiable. Marketing claims without them are misrepresentation.

### Legal & governance

- [ ] **Designate a privacy contact / DPO**. Article 37 only mandates a DPO in specific cases, but procurement always asks. Publish an email like `dpo@llmgateway.io`.
- [ ] **Appoint an EU Representative (Article 27)** if we have no EU establishment. Use a service like Prighter / EDPO (~€500–1500/yr).
- [ ] **Records of Processing Activities (RoPA, Article 30)** — internal doc listing every processing purpose, legal basis, data categories, recipients, retention. Template: ICO/CNIL templates work.
- [ ] **DPIA** for the LLM-routing processing activity (high-risk profiling potential under Article 35). Document residual risk and mitigations.
- [ ] **Standard Contractual Clauses (SCCs) + Transfer Impact Assessments (TIAs)** for every non-EU sub-processor (OpenAI US, Anthropic US, Google US, AWS, Azure, etc.). Use the 2021 EU SCCs (Module 3 — processor to sub-processor).
- [ ] **Breach notification runbook** — 72-hour clock under Article 33. Owner, contact tree, template notice for ICO/Datatilsynet/CNIL.
- [ ] **Data Subject Request (DSR) procedure** — internal SLA (we recommend ≤14 days; legal max 30) covering access, rectification, erasure, portability, objection. Owner + ticket template.

### Contracts

- [ ] **Drafted DPA** (Data Processing Agreement) with EU SCCs annexed. Have it reviewed by EU privacy counsel. Standard for B2B SaaS — every enterprise prospect will demand one.
- [ ] **Sub-processor agreements** — verify every upstream provider has a DPA with us (OpenAI, Anthropic, Google, AWS, Azure, Stripe, PostHog, hosting, email). Catalogue what they have and what's missing.

### Technical

- [ ] **EU data residency option** — at minimum offer EU-only routing (route only to provider EU regions: OpenAI EU, Anthropic EU when GA, Vertex EU, Azure EU). Long-term: EU-hosted gateway deployment.
- [ ] **Default to metadata-only retention** for new EU orgs (already configurable, just default-flip).
- [ ] **Account deletion → cascading hard delete** within 30 days (verify worker job exists; if not, build it).
- [ ] **Data export endpoint (Article 20 portability)** — JSON export of org data: orgs, projects, API keys, usage logs, billing records.
- [ ] **Cookie consent banner** — EU/UK visitors only is fine, but must block non-essential cookies (PostHog) until consent. Use a compliant banner (CookieYes, Osano, or roll one with `next-cookie-consent` patterns).
- [ ] **Encryption at rest** for stored prompts when retention is on (verify Postgres + S3-equivalent encryption are on).
- [ ] **PII redaction option** — optional inbound prompt scrubbing before forwarding to providers (sales unlock for regulated industries).

---

## Layer 2 — Provable surface (the marketing/proof assets)

This is where the content-strategy skill applies. Each asset below maps to a procurement question or a search query.

### Trust hub — `/trust` (new top-level page)

The single most important asset. Procurement reviewers send this URL to legal. It should answer every common question without a sales call.

**Sections:**
- One-line positioning ("EU-ready LLM infrastructure")
- Compliance badges (GDPR, SOC 2 if pursuing, ISO 27001 if pursuing) — only display what's real
- Quick-link cards: Privacy policy · Terms · DPA · Sub-processors · Security · Status
- "Where your data goes" diagram — request flow with retention, encryption, sub-processors visible
- Data residency commitments
- DSR contact + SLA
- DPO + EU representative contact
- Last-reviewed date

Routes to add: `/trust`, `/trust/gdpr`, `/trust/security`, `/trust/sub-processors`, `/trust/dpa`.

### Legal pages

- [ ] **`/legal/dpa`** — DPA viewable as page + downloadable PDF + clickwrap "I've signed this" flow for customers who don't want to e-sign with DocuSign. Embed via PandaDoc/DocuSign for enterprise tier.
- [ ] **`/legal/sub-processors`** — public table: name, purpose, location, transfer mechanism. Plus a "subscribe to changes" form (legal requirement under most DPAs to give 30-day notice of new sub-processors).
- [ ] **`/legal/cookie-policy`** — separate page enumerating every cookie, purpose, expiry. Required by ePrivacy.
- [ ] **`/legal/privacy` rewrite** — current version is decent but lacks: legal basis per purpose, exact retention periods, DPO contact, EU rep, list of sub-processors (or link), DSR mechanics, lodging-a-complaint clause (link to local DPA), automated decision-making disclosure (Article 22).
- [ ] **`/legal/security`** — technical controls page (encryption, access controls, vuln management, employee training, MFA, key rotation, backup/DR).

### In-product proof

- [ ] **Privacy & Compliance settings page** in-dashboard consolidating: data retention level, region preference, DPA status (signed/not), data export button, account deletion button.
- [ ] **"Download my data" button** triggering the Article 20 export.
- [ ] **"Delete my account" flow** with double-confirm + email confirmation + clear what gets deleted vs retained (e.g., we keep invoice records 7 years for tax law — that's a GDPR-permitted exception under Article 6(1)(c)).
- [ ] **DPA signing CTA** in billing settings — "Need a signed DPA? Sign here" → embed e-sign flow.
- [ ] **Footer link to `/trust`** from every page.
- [ ] **Cookie banner** — block PostHog/analytics until consent.

---

## Layer 3 — Content strategy (drive EU search traffic to the proof)

This is the searchable + shareable content layer. Pillar lives at `/blog` with cross-links into `/trust`.

### Pillar: "GDPR for LLM APIs"

Three subtopic clusters:

**Cluster 1 — Awareness (high-volume, top-of-funnel)**
- "Is ChatGPT GDPR compliant?" — high search volume, ranks well, redirects to comparison
- "Is OpenAI API GDPR compliant?"
- "Using LLMs in the EU: a developer's guide to GDPR"
- "GDPR and AI: what changed with the EU AI Act"
- "Sub-processor management for AI APIs"

**Cluster 2 — Consideration (commercial)**
- "How to use OpenAI in the EU (without breaking GDPR)" — use-case content, ICP-fit
- "GDPR-compliant LLM gateway: what to look for"
- "Self-host vs managed LLM gateway for GDPR"
- "DPA for AI APIs: what every B2B startup needs"
- "OpenRouter vs LLM Gateway for EU teams" (extends existing `/compare/open-router`)
- "LiteLLM vs LLM Gateway for GDPR" (extends existing `/compare/litellm`)

**Cluster 3 — Decision / Implementation**
- "How LLM Gateway handles GDPR" (drives directly to `/trust`)
- "Configuring data retention for GDPR" (links to existing `/features/data-retention`)
- "BYOK and GDPR: why bringing your own provider keys reduces risk"
- Customer story: "How [EU company] uses LLM Gateway under GDPR" (when we have one)

### Shareable / thought leadership

- "We read 30 LLM provider DPAs so you don't have to" — original analysis, link-bait, demonstrates expertise. Tie to a downloadable comparison table (lead magnet).
- "The hidden GDPR risk in AI router caching" — controversial take, drives discussion.
- "Why we default new EU orgs to metadata-only retention" — meta/transparency post.

### SEO scaffolding

- All `/trust/*` routes in `sitemap.xml`
- `og:image` per page
- Schema.org `Organization` markup with `address`, `contactPoint` for DPO
- Internal links from `/pricing`, `/enterprise`, `/features/*` into `/trust`
- `llms.txt` already exists — add trust/compliance summary

---

## Prioritized TODO list

Ordered by sequencing, not by effort. The legal foundation gates the public claims.

### Phase 1 — Foundation (weeks 1–4) — must finish before publishing any new claims

1. [ ] Engage EU privacy counsel (1–2 hour scoping call, ongoing retainer).
2. [ ] Designate privacy contact, set up `dpo@llmgateway.io` mailbox + ticket routing.
3. [ ] Appoint EU Representative (use Prighter/EDPO).
4. [ ] Build the RoPA (internal spreadsheet, owner = founder).
5. [ ] Run a DPIA for the gateway processing activity.
6. [ ] Inventory every sub-processor; collect their DPAs and confirm SCCs.
7. [ ] Draft our customer-facing DPA (counsel-reviewed).
8. [ ] Write the breach notification runbook + DSR procedure (internal docs).
9. [ ] Audit at-rest encryption for prompt storage.

### Phase 2 — In-product proof (weeks 3–6) — can start in parallel with Phase 1

10. [ ] Ship "Download my data" (Article 20 export endpoint + dashboard button).
11. [ ] Ship account deletion flow with cascading hard-delete + email confirmation.
12. [ ] Add EU-only routing toggle (org-level setting; restricts to provider EU regions).
13. [ ] Default new EU-IP signups to metadata-only retention.
14. [ ] Build cookie consent banner (block PostHog until consent).
15. [ ] Build "Privacy & Compliance" dashboard page consolidating retention/region/export/delete.
16. [ ] Add DPA signing flow (DocuSign/PandaDoc embed) in billing settings.

### Phase 3 — Public trust surface (weeks 5–7)

17. [ ] Build `/trust` hub page.
18. [ ] Build `/legal/sub-processors` (public list + email-subscribe for change notifications).
19. [ ] Build `/legal/dpa` (viewable page + downloadable PDF + signing CTA).
20. [ ] Rewrite `/legal/privacy` to include all Article 13/14 specifics.
21. [ ] Add `/legal/cookie-policy` and `/legal/security`.
22. [ ] Update footer + nav to link `/trust`.
23. [ ] Add `Organization` schema markup with DPO contact.
24. [ ] Update `sitemap.xml`, `llms.txt`, `robots.txt` for new routes.

### Phase 4 — Content & distribution (weeks 6–10)

25. [ ] Write Cluster 1 awareness posts (3–5 articles, target ChatGPT/OpenAI GDPR keywords).
26. [ ] Write Cluster 2 consideration posts including the OpenRouter and LiteLLM GDPR comparisons.
27. [ ] Write the "30 DPAs" research piece + downloadable comparison table (lead magnet).
28. [ ] Add a GDPR section to existing `/compare/open-router` and `/compare/litellm` pages.
29. [ ] Write a changelog post announcing GDPR-readiness package, link from blog homepage.
30. [ ] Add GDPR badge to `/pricing` and `/enterprise` pages.
31. [ ] Add EU-region availability to `/reliability` page.

### Phase 5 — Optional but high-leverage (post-launch)

32. [ ] Pursue SOC 2 Type I (Vanta/Drata, ~3 months, ~$15k) — compliments GDPR for enterprise sales.
33. [ ] Pursue ISO 27001 (longer horizon).
34. [ ] First EU customer case study published.
35. [ ] Apply for EU Cloud Code of Conduct adherence (signals AI-specific compliance).
36. [ ] Quarterly DPA review cadence + sub-processor list audit (recurring task — good `/schedule` candidate).

---

## Key risks to flag

- **Don't display badges we haven't earned.** GDPR doesn't issue certifications (yet — Article 42 framework is still maturing). Saying "GDPR compliant" is acceptable; fake "GDPR certified" badges are a CNIL fine waiting to happen.
- **Sub-processor changes need 30-day customer notice** under most DPAs. Build the notification list before promising it.
- **Article 22 (automated decision-making)** — we route requests to LLMs that produce outputs. If a customer uses our gateway to make decisions about EU data subjects (credit, employment, etc.), they're the controller and we're processor — but our DPA must reflect that and our docs should say it explicitly.
- **AI Act overlap (Aug 2026 enforcement)** — GDPR isn't enough; high-risk AI uses also fall under EU AI Act. Worth a separate `/trust/ai-act` page once Phase 1–3 ship.

## Definition of done

We can confidently say "we're GDPR-ready" when:
- An EU enterprise prospect can complete a security review using only public pages + signed DPA, no sales call required.
- A user can self-serve export and delete their data in-product.
- Every sub-processor has a current DPA + transfer mechanism on file.
- Breach + DSR runbooks are written, owned, and rehearsed once.
- We have inbound traffic from "GDPR LLM" keyword cluster landing on `/trust`.
