# Weekly Product Metrics — 2026-06-15

> **Windows:** this_week = Jun 8–15 | last_week = Jun 1–8  
> **Sources:** PostHog project LLMGateway (id: 163518). All numbers from HogQL queries; no invented values.

---

## Overall Traffic (this week vs last week)

| Host | PV (W) | PV (LW) | WoW PV | Uniques (W) | Uniques (LW) | WoW Uniques | Sessions (W) | Sessions (LW) | WoW Sessions |
|---|---|---|---|---|---|---|---|---|---|
| llmgateway.io | 13,074 | 12,892 | +1.4% | 3,010 | 2,525 | +19.2% | 4,089 | 3,431 | +19.2% |
| docs.llmgateway.io | 2,101 | 1,750 | +20.1% | 1,041 | 502 | **+107.4%** | 1,149 | 608 | **+88.9%** |
| chat.llmgateway.io | 836 | 525 | **+59.2%** | 240 | 166 | +44.6% | 339 | 247 | +37.2% |
| code.llmgateway.io | — | — | no data | — | — | — | — | — | — |

---

## llmgateway.io

**Headline:** PV nearly flat (+1.4%) but unique visitors and sessions up ~19%. Bounce rate ticked up slightly; avg PVs/session dipped.

### Bounce rate / Depth
| Metric | This week | Last week | Delta |
|---|---|---|---|
| Bounce rate | 55.9% | 52.9% | +3.0 pp |
| Avg PV / session | 3.20 | 3.76 | −0.56 |

### Top 10 Pages
| Page | PVs | Uniques |
|---|---|---|
| `/` | 2,628 | 1,672 |
| `/models` | 976 | 422 |
| `/pricing` | 603 | 476 |
| `/signup` | 472 | 379 |
| `/dashboard` | 421 | 183 |
| `/login` | 269 | 197 |
| `/onboarding` | 195 | 137 |
| `/timeline` | 141 | 93 |
| `/features/unified-api-interface` | 136 | 114 |
| `/models/claude-fable-5` | 117 | 79 |

Notable: `/models/claude-fable-5` making the top 10 suggests Fable 5 launch is driving model-page traffic. `/referrals` (77 PV) and `/token-cost-calculator` (72 PV) appear just outside top 10.

### Top 10 Referrers
| Referrer | Visits | Notes |
|---|---|---|
| (direct) | 6,243 | 47.8% of all visits |
| www.google.com | 4,320 | 33.0% — dominant |
| llmgateway.io (self) | 634 | Internal navigation artefact |
| devpass.llmgateway.io | 478 | ⚠️ Internal subdomain — likely team/auth redirect; may inflate numbers |
| t.co | 275 | Twitter/X |
| github.com | 153 | |
| www.bing.com | 121 | |
| www.reddit.com | 108 | |
| opencode.ai | 67 | Notable partner traffic |
| chatgpt.com | 63 | |

Also seen: `huntscreens.com` (60) — screenshot-crawler tool; `114.114.114.114:9421` (10) — suspicious IP referrer; `perplexity.premiium.click` (4) — typosquatted referrer spam (see Bot flags).

### Top 10 Countries
| Country | PVs | Uniques |
|---|---|---|
| United States | 1,641 | 676 |
| India | 1,292 | 239 |
| South Korea | 910 | 102 |
| Morocco | 653 | 123 |
| China | 639 | 143 |
| Poland | 517 | 48 |
| Germany | 487 | 140 |
| Japan | 408 | 83 |
| France | 391 | 107 |
| Hong Kong | 385 | 49 |

⚠️ Saudi Arabia (327 PV / 15 uniques = **21.8:1 ratio**) — see Bot flags.

### Device Breakdown
| Device | PVs | Uniques |
|---|---|---|
| Desktop | 10,104 | 2,311 |
| Mobile | 2,895 | 719 |
| Tablet | 74 | 18 |

### Conversion events
| Event | W occ | LW occ | WoW occ | W uniq | LW uniq | WoW uniq |
|---|---|---|---|---|---|---|
| user_signed_up | 125 | 112 | +11.6% | 125 | 112 | +11.6% |
| user_logged_in | 45 | 40 | +12.5% | 33 | 36 | −8.3% |
| onboarding_completed | 41 | 217 | **−81.1% ⚠️** | 37 | 204 | **−81.9% ⚠️** |
| onboarding_try_success | 19 | 74 | **−74.3% ⚠️** | 19 | 65 | **−70.8% ⚠️** |
| api_key_created | 134 | 68 | +97.1% | 114 | 48 | +137.5% |
| credits_purchased | 109 | 101 | +7.9% | 1 | 1 | 0% |
| topup_completed | 32 | 28 | +14.3% | 19 | 19 | 0% |
| subscription_created | 3 | 5 | −40.0% | 1 | 1 | 0% |
| cta_clicked | 274 | 303 | −9.6% | 148 | 168 | −11.9% |
| pricing_plan_clicked | 34 | 36 | −5.6% | 28 | 29 | −3.4% |
| provider_key_added | 36 | 17 | +111.8% | 11 | 11 | 0% |

**Funnel leak:** `/signup` got 472 PVs (379 uniques) → 125 `user_signed_up` = ~33% page-to-signup conversion. But of those who signed up, only 37 unique users completed onboarding this week vs 204 last week — that's an **82% collapse in onboarding completion rate** despite signups rising.

---

## docs.llmgateway.io

**Headline:** Huge traffic surge (sessions +89%, uniques +107%) but bounce rate spiked sharply and depth cratered — influx looks low-intent or bot-driven.

### Bounce rate / Depth
| Metric | This week | Last week | Delta |
|---|---|---|---|
| Bounce rate | 76.1% | 56.7% | **+19.4 pp ⚠️** |
| Avg PV / session | 1.83 | 2.88 | **−1.05 ⚠️** |

### Top 10 Pages
| Page | PVs | Uniques |
|---|---|---|
| `/` | 519 | 340 |
| `/self-host` | 149 | 116 |
| `/quick-start` | 121 | 96 |
| `/guides/cursor` | 77 | 68 |
| `/overview` | 69 | 57 |
| `/features/routing` | 51 | 46 |
| `/v1_models` | 38 | 34 |
| `/features/api-keys` | 36 | 29 |
| `/features/anthropic-endpoint` | 32 | 31 |
| `/features/reasoning` | 28 | 28 |

Notable: `/features/video-generation` and `/features/image-generation` (28 each) outside top 10 — media generation docs getting attention.

### Top 10 Referrers
| Referrer | Visits |
|---|---|
| (direct) | 1,711 |
| www.google.com | 213 |
| llmgateway.io | 67 |
| docs.llmgateway.io (self) | 27 |
| t.co | 17 |
| www.perplexity.ai | 11 |
| kagi.com | 11 |
| chatgpt.com | 10 |
| duckduckgo.com | 5 |
| bing.com | 5 |

### Top 10 Countries
| Country | PVs | Uniques | PV/Unique |
|---|---|---|---|
| Singapore | 487 | 461 | 1.06 |
| United States | 229 | 120 | 1.9 |
| India | 154 | 40 | 3.9 |
| China | 128 | 85 | 1.5 |
| South Korea | 102 | 28 | 3.6 |
| Morocco | 88 | 17 | 5.2 |
| Germany | 72 | 30 | 2.4 |
| United Kingdom | 65 | 11 | 5.9 |
| Australia | 60 | 11 | 5.5 |
| Poland | 57 | 13 | 4.4 |

⚠️ Singapore accounts for 44% of all doc unique visitors (461/1,041) this week. The 1.06:1 PV/unique ratio itself is clean but the concentration is anomalous — investigate whether this is datacenter/VPN traffic or a viral share in a Singaporean community.

### Device Breakdown
| Device | PVs | Uniques |
|---|---|---|
| Desktop | 1,910 | 942 |
| Mobile | 186 | 98 |
| Tablet | 5 | 4 |

---

## code.llmgateway.io

**No data** — zero pageview events recorded for this host in either time window. Either PostHog is not instrumented on this app, or the host name differs from `code.llmgateway.io`. Needs investigation.

---

## chat.llmgateway.io

**Headline:** Strong growth across all traffic metrics. Bounce rate improving. Playground usage growing in volume.

### Bounce rate / Depth
| Metric | This week | Last week | Delta |
|---|---|---|---|
| Bounce rate | 57.8% | 62.2% | **−4.4 pp ✅** |
| Avg PV / session | 2.47 | 2.13 | +0.34 ✅ |

### Top 10 Pages
| Page | PVs | Uniques |
|---|---|---|
| `/` | 509 | 184 |
| `/pricing` | 98 | 43 |
| `/signup` | 49 | 40 |
| `/video` | 34 | 13 |
| `/image` | 32 | 9 |
| `/canvas` | 24 | 11 |
| `/group` | 23 | 15 |
| `/login` | 17 | 16 |
| `/share/SBfaXGBzJuXTTmbA2zaI` | 16 | 15 |
| `/audio` | 13 | 3 |

Note: `/audio` has 13 PVs from 3 unique visitors (4.3:1) — within normal bounds.

### Top 10 Referrers
| Referrer | Visits |
|---|---|
| (direct) | 687 |
| www.google.com | 61 |
| t.co | 40 |
| chat.llmgateway.io (self) | 19 |
| chatgpt.com | 11 |
| llmgateway.io | 7 |
| statics.teams.cdn.office.net | 5 |
| smakosh.com | 4 |
| www.perplexity.ai | 1 |
| fofa.ai4s.cn | 1 |

Notable: `fofa.ai4s.cn` is a Chinese security/OSINT scanning tool — likely a crawler.

### Top 10 Countries
| Country | PVs | Uniques | PV/Unique |
|---|---|---|---|
| Morocco | 150 | 16 | 9.4 |
| Poland | 95 | 3 | **31.7 ⚠️** |
| United States | 78 | 32 | 2.4 |
| India | 71 | 18 | 3.9 |
| Singapore | 49 | 47 | 1.0 |
| South Korea | 34 | 10 | 3.4 |
| Canada | 31 | 13 | 2.4 |
| France | 28 | 8 | 3.5 |
| Saudi Arabia | 24 | 3 | 8.0 |
| Italy | 20 | 3 | 6.7 |

### Playground events
| Event | W occ | LW occ | WoW occ | W uniq | LW uniq | WoW uniq |
|---|---|---|---|---|---|---|
| playground_chat_sent | 315 | 331 | −4.8% | 32 | 58 | **−44.8%** |
| playground_image_generated | 21 | 15 | +40.0% | 4 | 2 | +100% |
| playground_video_generated | 13 | 5 | +160.0% | 2 | 2 | 0% |
| playground_group_chat_started | 2 | 0 | **new** | 2 | 0 | new |

Chat sends are down in unique users (−45%) even as volume is stable — suggests a smaller cohort of heavy users driving volume.

---

## Product Events (All Hosts, this week vs last week)

| Event | W occ | LW occ | WoW occ | W uniq | LW uniq | WoW uniq |
|---|---|---|---|---|---|---|
| user_signed_up | 125 | 112 | +11.6% | 125 | 112 | +11.6% |
| user_logged_in | 45 | 40 | +12.5% | 33 | 36 | −8.3% |
| onboarding_completed | 41 | 217 | **−81.1% ⚠️** | 37 | 204 | **−81.9% ⚠️** |
| onboarding_try_success | 19 | 74 | **−74.3% ⚠️** | 19 | 65 | **−70.8% ⚠️** |
| api_key_created | 134 | 68 | +97.1% | 114 | 48 | +137.5% |
| credits_purchased | 109 | 101 | +7.9% | 1 | 1 | 0% |
| subscription_created | 3 | 5 | −40.0% | 1 | 1 | 0% |
| dev_plan_started | 27 | 61 | **−55.7% ⚠️** | 1 | 1 | 0% |
| dev_plan_subscribe_started | 48 | 124 | **−61.3% ⚠️** | 37 | 68 | **−45.6% ⚠️** |
| dev_plan_renewed | 8 | 14 | −42.9% | 1 | 1 | 0% |
| dev_plan_tier_changed | 17 | 9 | +88.9% | 15 | 8 | +87.5% |
| provider_key_added | 36 | 17 | +111.8% | 11 | 11 | 0% |
| pricing_plan_clicked | 34 | 36 | −5.6% | 28 | 29 | −3.4% |
| topup_completed | 32 | 28 | +14.3% | 19 | 19 | 0% |
| cta_clicked | 274 | 303 | −9.6% | 148 | 168 | −11.9% |
| playground_chat_sent | 315 | 331 | −4.8% | 32 | 58 | −44.8% |
| playground_image_generated | 21 | 15 | +40.0% | 4 | 2 | +100% |
| playground_video_generated | 13 | 5 | +160.0% | 2 | 2 | 0% |
| playground_group_chat_started | 2 | 0 | new | 2 | 0 | new |

---

## Top 3 Things to Investigate This Week

### 1. Onboarding funnel is broken — signups up but completions collapsed 81%
- `user_signed_up`: 112 → 125 (+11.6%)
- `onboarding_completed`: 217 → 41 unique users (−81.9%)
- `onboarding_try_success`: 74 → 19 (−74.3%)
- This is the sharpest regression in the dataset. More people are signing up but almost none are reaching onboarding completion or trying the product. Likely a UX regression, feature flag issue, or broken step in the onboarding flow. Check for deploy between Jun 1–8 that touched `/onboarding`. Note: `api_key_created` went up (+137%) suggesting some users are skipping to the API directly — possibly the onboarding skip path is now too prominent, or a step is erroring silently.

### 2. dev_plan_subscribe_started and dev_plan_started both cratered
- `dev_plan_subscribe_started`: 124 → 48 (−61.3%), 68 → 37 unique users (−45.6%)
- `dev_plan_started`: 61 → 27 (−55.7%)
- This is on top of the onboarding collapse — if users aren't completing onboarding, they're also not reaching the dev plan. However the drops are larger than signup-to-onboarding attrition alone explains. Also check if `code.llmgateway.io` tracking is missing (zero data this week), which could mean dev plan events from that surface are also untracked.

### 3. docs.llmgateway.io bounce rate spiked +19.4 pp; Singapore accounts for 44% of uniques
- Bounce rate went from 56.7% → 76.1%, avg pages/session 2.88 → 1.83, while sessions nearly doubled (608 → 1,149).
- Singapore drove 461 of 1,041 unique visitors (44%). Singapore PV/unique ratio is clean (1.06) but the geographic concentration is anomalous. May indicate a viral link share in a dev community, a scraper cluster, or indexing bots. Cross-reference session recordings from Singaporean IPs before attributing this to organic growth.

---

## Bot / Data-Quality Flags

| Type | Detail | Severity |
|---|---|---|
| **Geo bot pattern** | chat.llmgateway.io — Poland: 95 PV / 3 uniques = **31.7:1** (threshold: >20:1 with ≥50 PV) | ⚠️ Flag |
| **Geo bot pattern** | llmgateway.io — Saudi Arabia: 327 PV / 15 uniques = **21.8:1** (threshold: >20:1 with ≥50 PV) | ⚠️ Flag |
| **Suspicious referrer** | `perplexity.premiium.click` → llmgateway.io (4 visits) — typosquatted referrer spam domain | ⚠️ Flag |
| **Suspicious referrer** | `114.114.114.114:9421` → llmgateway.io (10 visits) — Chinese public DNS IP used as HTTP referrer; classic referrer spam | ⚠️ Flag |
| **Screenshot crawler** | `huntscreens.com` → llmgateway.io (60 visits) — automated screenshot service; inflates session count | Informational |
| **Self-referrer** | `chat.llmgateway.io` → chat.llmgateway.io (19 visits); `docs.llmgateway.io` → docs (27 visits) — likely SPA navigation misfires, not real external referrals | Informational |
| **Internal subdomain referrer** | `devpass.llmgateway.io` → llmgateway.io (478 visits, 4th-largest referrer) — if this is an internal auth/dev portal, its traffic may inflate main-site session counts and skew acquisition attribution | Informational |
| **Missing host tracking** | `code.llmgateway.io` — zero events in PostHog for either window. Either PostHog SDK is not installed or host name differs. | Action required |
| **Docs Singapore cluster** | 461 unique visitors from Singapore to docs (44% of total uniques) in a single week with near-1:1 PV ratio — origin unclear, monitor next week | Watch |
