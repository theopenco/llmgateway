# Airside SEO and AI search audit

September 11, 2026. Scope: Airside’s public acquisition pages, provider resources and discoverability. Skills: seo-audit, ai-seo, free-tools, copywriting and analytics.

## Findings and applied fixes

The live homepage returned HTTP 200 with a canonical, description, one H1 and rendered WebSite, Organization and FAQPage JSON-LD. Source review confirmed public crawler access, account-page noindex rules, a sitemap and existing `llms.txt` and `pricing.md`. Replacing those foundations would add little value. The largest gaps were useful provider content, trustworthy copy, mobile navigation and measurement.

| Priority | Finding and evidence                                                                                                                                  | Applied fix                                                                                                                                                                                   |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | The sitemap contained only the homepage and two legal pages. No public tools or provider guides existed.                                              | Added a resource hub, two substantive provider guides and two working, ungated calculators. Linked them from the homepage, header, footer, related-resource sections, sitemap and `llms.txt`. |
| High     | At a 390px viewport, live header controls extended beyond the page.                                                                                   | Shortened the mobile signup label, hid the wordmark on small screens and reserved the full navigation for wide screens.                                                                       |
| High     | Homepage and `llms.txt` copy implied domain matching immediately cleared a claim and active metadata could be edited freely. The API requires review. | Distinguished ownership verification, claim review, preflight and approval; corrected the active-metadata policy.                                                                             |
| Medium   | The decorative departure board labeled fixed sample rows “LIVE.”                                                                                      | Marked it as an illustration. Added links to real model rankings in public navigation and the provider dashboard.                                                                             |
| Medium   | Provider setup and pricing answers were scattered across product copy and docs.                                                                       | Added direct definitions, ordered setup steps, a pricing-unit table, formulas, limitations and links to the live catalogue and documentation.                                                 |
| Medium   | New content needed independent search and sharing metadata.                                                                                           | Added page-specific titles, descriptions, canonicals and social metadata, Article or WebApplication JSON-LD, and visible guide attribution and update dates.                                  |
| Medium   | The traffic-report script omitted Airside and retained a legacy chat-host entry. Airside had no browser pageview initialization.                      | Replaced the legacy host with Airside, retained Lounge, and enabled configured PostHog pageviews without form autocapture or session recording.                                               |

## Page and tool strategy

| Page                            | Search intent                                    | Useful outcome                                                                                           |
| ------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `/guides/list-your-llm-api`     | List an LLM API; provider onboarding             | Prepare domain proof, canonical IDs, capabilities and initial fares.                                     |
| `/guides/llm-inference-pricing` | LLM inference pricing for providers              | Distinguish token units, cached input, request charges, routing and settlement.                          |
| `/tools/token-cost-calculator`  | LLM token cost calculator                        | Estimate request and monthly cost using a provider’s own rates, including cached input and flat charges. |
| `/tools/rate-limit-calculator`  | API rate limit calculator; RPM to daily capacity | Find the binding daily ceiling and concurrency at the full minute rate.                                  |

Both tools run locally in the browser, need no account, explain assumptions and link to provider registration. Their initial values are examples, not catalogue prices. This avoids maintaining a second price list and gives providers a useful result before signup.

## AI search assessment

The new guides answer provider questions in ordinary server-rendered text with clear headings, source links and visible authorship. Their content and calculator explanations remain readable without JavaScript. Structured data describes the visible content; no fabricated reviews, traffic numbers or citation claims were added.

Search spot checks covered Airside discovery and LLM pricing calculators. Results support the existence of calculator intent but do not establish keyword volume, rankings or AI citations. No authenticated Search Console, CrUX or cross-platform AI citation dataset was available, so this audit makes no measured visibility or Core Web Vitals claim.

Google’s guidance supports useful original content, crawlability and ordinary SEO foundations; it does not require special AI files or promise visibility from a particular schema. Existing machine-readable summaries were updated for consistency, not treated as ranking guarantees. [Google’s AI optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide), [helpful content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content).

## Measurement after deployment

Use Search Console to check indexing and query impressions for the five new URLs. Compare organic landing-page visits, resource-to-signup journeys and provider registrations across complete reporting periods. Pageviews begin when Airside’s PostHog configuration is present; this change does not backfill earlier traffic.

Establish a dated citation baseline for provider listing, canonical model IDs, inference pricing, cached-input cost and API capacity queries in the AI search products being targeted. Repeat the same queries and record cited URLs. Track results separately from conventional search impressions and referrals.

## Verification

- `pnpm install --frozen-lockfile`, `pnpm format` and the full `pnpm build` passed (19 build tasks).
- The isolated Airside API suite passed all 60 tests, including canonical metadata and exclusion of retired or tiered catalogue tariffs.
- All 12 Airside browser tests passed, including registration, fare filing, calculator arithmetic and validation, four resource pages without JavaScript, self-canonicals, structured data and mobile overflow checks.
- Lounge’s browser regression passed: Chat-context log actions are disabled with PAYG guidance; regular organization logs retain their configured dashboard link.
- A local PostHog mock received initial and client-navigation pageviews with no calculator input, autocapture or session-recording events. The smoke browser simulated a regular browser because PostHog filters automated browsers.
- Report rendering included AirSide and Lounge without the legacy host label. No report notification was sent.
