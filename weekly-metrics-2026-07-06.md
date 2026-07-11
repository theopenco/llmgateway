# Weekly Product Metrics — 2026-07-06

> **Note on host names:** PostHog data shows `devpass.llmgateway.io` where the task spec referenced `code.llmgateway.io`. Report covers the four live hosts with data: `llmgateway.io`, `devpass.llmgateway.io`, `docs.llmgateway.io`, `chat.llmgateway.io`.

---

## Overall Traffic (this week vs last week)

| Product | PV (this) | PV (prev) | WoW PV | Uniques (this) | Uniques (prev) | WoW Uniques | Sessions (this) | Sessions (prev) | WoW Sessions |
|---------|-----------|-----------|--------|----------------|----------------|-------------|-----------------|-----------------|--------------|
| llmgateway.io | 19,700 | 17,832 | **+10%** | 4,347 | 4,250 | +2% | 5,853 | 5,606 | +4% |
| devpass.llmgateway.io | 10,747 | 8,285 | **+30%** | 843 | 627 | **+34%** | 2,483 | 1,978 | **+26%** ⚠️ |
| docs.llmgateway.io | 1,974 | 2,107 | -6% | 592 | 706 | **-16%** ⚠️ | 719 | 858 | **-16%** ⚠️ |
| chat.llmgateway.io | 1,063 | 1,181 | -10% | 250 | 285 | -12% | 324 | 391 | **-17%** ⚠️ |

---

## llmgateway.io

**Headline numbers**
- PV: 19,700 (+10% WoW) | Uniques: 4,347 (+2%) | Sessions: 5,853 (+4%)
- Session duration: 337.5s (+0%) | Bounce rate: 29.3% (improved from 30.0%, -2%)
- Avg PV/session: 3.37 (prev 3.18)

**Top 10 pages by views**

| Path | Uniques | Views |
|------|---------|-------|
| / | 2,035 | 3,252 |
| /models | 655 | 1,650 |
| /signup | 631 | 803 |
| /pricing | 621 | 789 |
| /timeline | 365 | 438 |
| /blog/best-ai-coding-plans | 330 | 388 |
| /login | 280 | 369 |
| /dashboard | 271 | 561 |
| /timeline/2026 | 179 | 255 |
| /features/unified-api-interface | 152 | 208 |

**Top 10 referrers**

| Referrer | Uniques | Views |
|----------|---------|-------|
| www.google.com | 2,025 | 8,097 |
| (direct) | 1,801 | 7,826 |
| t.co | 102 | 305 |
| devpass.llmgateway.io | 87 | 930 |
| llmgateway.io (self) | 84 | 576 |
| www.bing.com | 82 | 315 |
| www.reddit.com | 39 | 99 |
| accounts.google.com | 35 | 143 |
| opencode.ai | 33 | 140 |
| trustmrr.com | 31 | 75 |

- **Notable:** `opencode.ai` is a new referrer (AI coding tool) — worth monitoring as a potential growth channel.
- **Notable:** `trustmrr.com` (MRR tracking/review site) appearing — possible review or listing.

**Top 10 countries**

| Country | Uniques | Views |
|---------|---------|-------|
| US | 1,068 | 3,183 |
| IN | 321 | 1,336 |
| KR | 271 | 2,929 |
| CN | 224 | 893 |
| RU | 150 | 267 |
| DE | 137 | 568 |
| SG | 117 | 493 |
| GB | 115 | 311 |
| FR | 113 | 573 |
| BR | 108 | 546 |

- **⚠️ KR:** 271 visitors, 2,929 views — 10.8:1 ratio; elevated but below bot-flag threshold; watch.

**Device breakdown**

| Device | Uniques | Views | Share |
|--------|---------|-------|-------|
| Desktop | 3,456 | 14,979 | 78.5% |
| Mobile | 925 | 4,586 | 21.0% |
| Tablet | 21 | 137 | 0.5% |

**Bounce rate / avg PV per session**
- Bounce rate: 29.3% (prev 30.0%) — slightly improved
- Avg PV/session: 3.37 (prev 3.18)

**Flags**
- Bot/anomaly: dashboard path `/dashboard/s9O0cesCCD358r5xEEaK/.../activity` — 74 views from 1 unique visitor (74:1 ratio, ≥50 PV threshold). Likely a single power user or automated refresh.
- Bot referrer: `dynalist.io` — 70 views, 1 visitor (70:1). Investigate.
- Bot referrer: `temp-mail.org` — 66 views, 2 visitors (33:1). Disposable email service; may indicate account-creation abuse attempts.

---

## docs.llmgateway.io

**Headline numbers**
- PV: 1,974 (-6% WoW) | Uniques: 592 (**-16%** ⚠️) | Sessions: 719 (**-16%** ⚠️)
- Session duration: 485.5s (+10%) | Bounce rate: 30.2% (improved from 33.9%, -11%)
- Avg PV/session: 2.74 (prev 2.46)

**Top 10 pages by views**

| Path | Uniques | Views |
|------|---------|-------|
| / | 330 | 563 |
| /self-host | 87 | 132 |
| /quick-start | 83 | 104 |
| /guides/cursor | 81 | 96 |
| /overview | 75 | 98 |
| /v1_models | 44 | 60 |
| /features/routing | 43 | 56 |
| /self-host/docker | 36 | 44 |
| /features/anthropic-endpoint | 30 | 36 |
| /self-host/docker-compose | 27 | 34 |

- `/guides/cursor` in top 5 confirms strong cursor/AI-coding integration demand.
- Self-hosting pages (self-host, docker, docker-compose) indicate a healthy OSS/self-host audience.

**Top 10 referrers**

| Referrer | Uniques | Views |
|----------|---------|-------|
| (direct) | 310 | 1,023 |
| www.google.com | 216 | 547 |
| www.bing.com | 10 | 50 |
| llmgateway.io | 10 | 36 |
| docs.llmgateway.io (self) | 8 | 42 |
| devpass.llmgateway.io | 8 | 30 |
| t.co | 7 | 25 |
| chatgpt.com | 5 | 24 |
| www.reddit.com | 4 | 18 |
| statics.teams.cdn.office.net | 4 | 5 |

- **Notable:** `chatgpt.com` referring to docs — people asking ChatGPT about LLMGateway then visiting the docs.

**Top 10 countries**

| Country | Uniques | Views |
|---------|---------|-------|
| US | 133 | 352 |
| KR | 60 | 225 |
| CN | 49 | 148 |
| IN | 38 | 109 |
| JP | 25 | 182 |
| GB | 23 | 69 |
| SG | 21 | 59 |
| DE | 18 | 36 |
| FR | 14 | 30 |
| ES | 13 | 38 |

**Device breakdown**

| Device | Uniques | Views | Share |
|--------|---------|-------|-------|
| Desktop | 492 | 1,730 | 82.7% |
| Mobile | 98 | 211 | 16.5% |
| Tablet | 5 | 33 | 0.8% |

**Bounce rate / avg PV per session**
- Bounce rate: 30.2% (prev 33.9%) — improved despite traffic drop; readers who arrive are engaging more
- Avg PV/session: 2.74 (prev 2.46)

**Flags**
- **⚠️ Regression:** Uniques -16%, sessions -16% — just over the 15% flag threshold. Views only down -6%, meaning the existing audience is reading more pages per visit, but fewer new readers are arriving. Check if any docs SEO/linking changed this week.

---

## devpass.llmgateway.io

> This is the "Dev Plans" product (code.llmgateway.io equivalent). Strong growth this week, but significant bot-signal from KR traffic.

**Headline numbers**
- PV: 10,747 (+30% WoW) | Uniques: 843 (+34%) | Sessions: 2,483 (+26%)
- Session duration: 721.6s (-13%) | Bounce rate: 17.4% (improved from 18.6%, -7%)
- Avg PV/session: 4.33 (prev 4.19)

**Top 10 pages by views**

| Path | Uniques | Views |
|------|---------|-------|
| / | 666 | 1,824 |
| /pricing | 373 | 579 |
| /dashboard | 302 | 4,925 |
| /signup | 185 | 320 |
| /coding-models | 176 | 392 |
| /dashboard/billing | 135 | 850 |
| /leaderboard | 108 | 152 |
| /dashboard/settings | 105 | 385 |
| /login | 104 | 587 |
| /profile | 104 | 357 |

- `/dashboard`: 302 unique visitors, 4,925 views (16.3:1) — high but attributable to active logged-in sessions.
- `/pricing` and `/leaderboard` getting healthy traffic; leaderboard is a good engagement/sharing hook.

**Top 10 referrers**

| Referrer | Uniques | Views |
|----------|---------|-------|
| (direct) | 499 | 7,845 |
| www.google.com | 277 | 1,608 |
| devpass.llmgateway.io (self) | 31 | 532 |
| t.co | 27 | 59 |
| llmgateway.io | 21 | 68 |
| accounts.google.com | 14 | 258 |
| checkout.stripe.com | 12 | 128 |
| www.bing.com | 9 | 41 |
| duckduckgo.com | 7 | 34 |
| statics.teams.cdn.office.net | 6 | 13 |

- `checkout.stripe.com` → 12 visitors, 128 views (10.7:1): Users returning from Stripe checkout browsing billing. Normal.
- `statics.teams.cdn.office.net` appearing (Microsoft Teams) — potential enterprise/B2B signal.

**Top 10 countries**

| Country | Uniques | Views |
|---------|---------|-------|
| KR | 246 | 7,046 |
| US | 130 | 469 |
| IN | 38 | 176 |
| JP | 36 | 603 |
| CN | 24 | 34 |
| BR | 22 | 155 |
| SG | 21 | 70 |
| FR | 20 | 218 |
| DE | 18 | 319 |
| ID | 18 | 56 |

- **🚨 KR BOT FLAG:** 246 unique visitors generating 7,046 views (28.6:1 ratio). KR accounts for 29% of all devpass uniques yet 65% of all devpass pageviews. This is far above normal engagement patterns and almost certainly inflating the +30% WoW PV growth figure. The growth in uniques (+34%) may be more trustworthy, but the PV headline is suspect.
- JP: 36 visitors, 603 views (16.7:1) — also elevated, worth watching.

**Device breakdown**

| Device | Uniques | Views | Share |
|--------|---------|-------|-------|
| Desktop | 630 | 7,063 | 70.8% |
| Mobile | 248 | 3,481 | 27.9% |
| Tablet | 12 | 206 | 1.3% |

**Bounce rate / avg PV per session**
- Bounce rate: 17.4% (prev 18.6%) — low, consistent with an app/tool that drives deep engagement
- Avg PV/session: 4.33 (prev 4.19)

**Flags**
- **🚨 Bot geo cluster:** KR — 28.6:1 views-per-visitor ratio. devpass headline PV growth is likely inflated.
- **⚠️ Session duration -13%:** Despite more visits, users are spending less time per session. May indicate users hitting a wall earlier in the funnel.
- Referrer bot: `accounts.google.com` → 371 views, 14 visitors (26.5:1) — likely OAuth redirect loop (user retries Google sign-in repeatedly). Could indicate a login UX issue.

---

## chat.llmgateway.io

**Headline numbers**
- PV: 1,063 (-10% WoW) | Uniques: 250 (-12%) | Sessions: 324 (-17%)
- Session duration: 687.6s (**-29%** ⚠️) | Bounce rate: 11.4% (improved from 14.3%, -20%)
- Avg PV/session: 3.28 (prev 3.02)

**Top 10 pages by views**

| Path | Uniques | Views |
|------|---------|-------|
| / | 239 | 614 |
| /pricing | 90 | 248 |
| /signup | 39 | 42 |
| /video | 27 | 38 |
| /image | 16 | 32 |
| /group | 18 | 27 |
| /canvas | 15 | 19 |
| /audio | 12 | 13 |
| /login | 6 | 8 |
| /projects | 5 | 15 |

- `/pricing` is the #2 page (90 uniques) — high intent signal from playground visitors.
- `/video`, `/image`, `/group`, `/canvas`, `/audio` — multimodal features seeing meaningful but small traffic.

**Top 10 referrers**

| Referrer | Uniques | Views |
|----------|---------|-------|
| (direct) | 122 | 523 |
| www.google.com | 78 | 308 |
| substack.com | 15 | 60 |
| t.co | 6 | 37 |
| llmgateway.io | 4 | 19 |
| www.bing.com | 4 | 11 |
| devpass.llmgateway.io | 4 | 9 |
| www.producthunt.com | 3 | 14 |
| chatgpt.com | 3 | 12 |
| chat.llmgateway.io (self) | 3 | 9 |

- **Notable:** `substack.com` — a newsletter post is driving 15 unique visitors to the playground (3rd largest referrer). Worth identifying which newsletter.
- `producthunt.com` still sending a trickle — residual from a PH launch.

**Top 10 countries**

| Country | Uniques | Views |
|---------|---------|-------|
| US | 44 | 207 |
| IN | 22 | 110 |
| BR | 20 | 80 |
| SG | 18 | 34 |
| KR | 13 | 37 |
| JP | 10 | 35 |
| ID | 8 | 46 |
| NL | 7 | 25 |
| CN | 7 | 15 |
| DE | 6 | 26 |

**Device breakdown**

| Device | Uniques | Views | Share |
|--------|---------|-------|-------|
| Desktop | 186 | 719 | 72.4% |
| Mobile | 68 | 334 | 26.5% |
| Tablet | 3 | 10 | 1.1% |

**Bounce rate / avg PV per session**
- Bounce rate: 11.4% (prev 14.3%) — excellent; users who visit explore deeply
- Avg PV/session: 3.28 (prev 3.02)

**Flags**
- **⚠️ Session duration -29%:** Users who do visit are spending 4.4 min less per session than last week (11:28 → 11:28 vs 16:03). Combined with `playground_chat_sent` -33%, this strongly suggests a usage engagement drop — check for latency regressions, model availability issues, or pricing friction driving shorter sessions.
- **⚠️ Sessions -17%:** Regression past 15% threshold.

---

## Product Events

| Event | This Week | Users (TW) | Last Week | Users (LW) | WoW Count | WoW Users |
|-------|-----------|------------|-----------|------------|-----------|-----------|
| cta_clicked | 748 | 348 | 540 | 243 | +39% | +43% |
| api_key_created | 238 | 203 | 240 | 172 | **-1%** ⚠️ | +18% |
| dev_plan_subscribe_started | 134 | 91 | 117 | 77 | +15% | +18% |
| playground_chat_sent | 133 | 17 | 198 | 14 | **-33%** 🚨 | +21% |
| credits_purchased | 127 | 1 | 136 | 1 | **-7%** ⚠️ | 0% |
| pricing_plan_clicked | 101 | 73 | 66 | 50 | +53% | +46% |
| user_signed_up | 100 | 100 | 68 | 68 | **+47%** | +47% |
| dev_plan_started | 94 | 1 | 78 | 1 | +21% | 0% |
| onboarding_completed | 58 | 55 | 50 | 46 | +16% | +20% |
| user_logged_in | 41 | 32 | 27 | 25 | +52% | +28% |
| topup_completed | 35 | 10 | 44 | 14 | **-20%** 🚨 | **-29%** 🚨 |
| provider_key_added | 34 | 16 | 11 | 7 | +209% | +129% |
| dev_plan_renewed | 32 | 1 | 13 | 1 | +146% | 0% |
| onboarding_try_success | 22 | 17 | 22 | 20 | 0% | -15% |
| dev_plan_tier_changed | 21 | 18 | 19 | 15 | +11% | +20% |
| playground_image_generated | 16 | 5 | 7 | 2 | +129% | +150% |
| playground_video_generated | 4 | 3 | 4 | 4 | 0% | -25% |
| playground_group_chat_started | 4 | 4 | 0 | 0 | NEW | NEW |
| subscription_created | 1 | 1 | 0 | 0 | NEW | NEW |

**Highlights:**
- `user_signed_up` +47%, `user_logged_in` +52%, `onboarding_completed` +16% — strong top-of-funnel growth.
- `dev_plan_renewed` +146% — renewals accelerating (compounding base).
- `provider_key_added` +209% — more users bringing their own provider keys; healthy power-user signal.
- `playground_group_chat_started` first appearances this week (4 events, 4 users) — new feature gaining traction.
- `subscription_created` first occurrence (1 event) — likely the new subscription flow going live.

**Conversion events that dropped (flag all drops):**
- `api_key_created`: -1% (238 vs 240) — marginal but a conversion signal; despite 47% more signups, fewer API keys created per cohort.
- `credits_purchased`: -7% (127 vs 136) — purchase volume down despite more signups.
- `topup_completed`: -20% (35 vs 44) — significant drop in topups; only 10 unique users topped up vs 14 last week.

---

## Top 3 Things to Investigate This Week

### 1. 🚨 devpass.llmgateway.io KR bot traffic inflating PV headline
- KR: 246 visitors generated 7,046 pageviews (28.6:1 views/visitor) — accounting for 65% of total devpass pageviews from 29% of uniques.
- The +30% WoW PV jump on devpass is likely overstated; the real unique-visitor growth (+34%) is healthy but the raw PV number should not be used for goal-setting until KR traffic is investigated.
- Also check JP (36 visitors, 603 views, 16.7:1) on devpass.
- **Action:** Filter by KR in PostHog, review session recordings, check if these are real users or crawlers/scrapers on the dashboard/billing pages.

### 2. 🚨 playground_chat_sent -33% + chat session duration -29%
- `playground_chat_sent` dropped from 198 → 133 events despite the user base growing (17 vs 14 unique users, +21%).
- Per-user chat rate fell sharply: 7.8 chats/user this week vs 14.1 chats/user last week.
- Session duration on chat.llmgateway.io simultaneously dropped 29% (962s → 688s).
- This pattern suggests a product regression rather than an audience shift — possibly a latency issue, model error spike, or pricing change that stops users mid-session.
- **Action:** Check gateway error rates and latency for the models served by the playground; review session recordings; check if any pricing/credit changes went live mid-week.

### 3. 🚨 topup_completed -20% despite user_signed_up +47%
- New signups surged (+47%) but topups fell -20% (35 vs 44) with fewer unique topup users (10 vs 14).
- `api_key_created` also edged down -1% and `credits_purchased` fell -7% — suggesting the new cohort of signups this week is not converting to paid actions at the same rate as the prior cohort.
- `onboarding_try_success` was flat (22 vs 22) — the try-before-buy success rate didn't improve even with more signups, pointing to a funnel leak between sign-up and first successful API call.
- **Action:** Segment `user_signed_up` by referrer this week vs last; check if the new signup cohort source (t.co, opencode.ai spike) has lower payment intent. Review `onboarding_try_error` volume and messages.

---

## Bot / Data-Quality Flags

| Type | Host | Detail | Views | Uniques | Ratio |
|------|------|--------|-------|---------|-------|
| Page anomaly | llmgateway.io | `/dashboard/s9O0cesCCD358r5xEEaK/.../activity` | 74 | 1 | 74:1 |
| Referrer | llmgateway.io | `dynalist.io` | 70 | 1 | 70:1 |
| Referrer | llmgateway.io | `temp-mail.org` | 66 | 2 | 33:1 |
| Referrer | devpass.llmgateway.io | `accounts.google.com` | 371 | 14 | 26.5:1 |
| Geo cluster | devpass.llmgateway.io | KR (South Korea) | 7,046 | 246 | 28.6:1 |
| Geo cluster | devpass.llmgateway.io | JP (Japan) | 603 | 36 | 16.7:1 |

**Notes:**
- `temp-mail.org` referring to llmgateway.io is a strong signal for disposable-email account creation attempts; if user_signed_up events from these sessions are included in the +47% signup count, the headline is misleading.
- `dynalist.io` (note-taking app) with 70 views from 1 visitor — likely a single user who bookmarked links in Dynalist and repeatedly opened them from there.
- `accounts.google.com` 26.5:1 ratio on devpass: may reflect users failing/retrying Google OAuth repeatedly. Investigate the OAuth flow for UX friction.
- KR / JP devpass geo clusters: check UA strings and session recordings for bot-like behavior (zero interaction, predictable intervals, same pages).
