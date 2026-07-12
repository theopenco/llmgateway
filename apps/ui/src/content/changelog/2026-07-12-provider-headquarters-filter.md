---
id: "65"
slug: "provider-headquarters-filter"
date: "2026-07-12"
title: "Provider Headquarters Compliance Filter"
summary: "Restrict routing to providers headquartered in the countries you approve. Pick allowed countries on the compliance page and the gateway blocks any provider based elsewhere — before a request leaves the gateway. Available on Enterprise."
image:
  src: "/changelog/provider-headquarters-filter.png"
  alt: "Provider headquarters compliance filter on LLM Gateway: a country selector with flags restricting routing by provider location"
  width: 1536
  height: 1024
---

Data-residency and vendor-jurisdiction rules often come down to a simple question: where is the provider based? Until now the compliance policy could gate providers on certifications and data handling, but not on location. The **provider headquarters filter** adds that control — choose the countries you allow, and the gateway only routes to providers headquartered there.

## Pick allowed countries

Open **Organization → Compliance** and enable the provider compliance policy. A new **Provider Headquarters** card shows a country selector, rendered as flag chips. Select one or more countries to restrict routing to providers based in them; leave every country unselected to allow any location.

The selector only offers countries that are actually referenced in the model catalogue, so there is nothing to choose that no provider can satisfy. Browse the [providers directory](https://llmgateway.io/providers) to see every provider and its headquarters.

The **Provider Impact** card updates live as you select countries, splitting every provider into allowed and blocked so you can see the effect before saving.

## Enforced at the gateway, fail-closed

The country filter composes with the existing certification and data-policy requirements — a provider must satisfy all of them. Enforcement happens during routing: a provider whose headquarters is not in your allowed list is dropped from the candidate set, and a pinned provider that fails the policy is rejected with `403` before any request data leaves the gateway. Providers with an unknown headquarters are treated as non-compliant when a country filter is set, so the policy never leaks through a gap.

## Browse providers by country

The public **[Providers directory](https://llmgateway.io/providers)** now has a page per country — for example `/providers/country/us` — listing every provider headquartered there and the models they serve. Each provider card links to its country page from the location badge.

## Availability

The provider headquarters filter is available on the **Enterprise plan** for organization owners and admins, alongside the rest of the provider compliance policy.

---

**[Compliance docs →](https://docs.llmgateway.io/features/compliance)** | **[Contact us about Enterprise →](https://llmgateway.io/enterprise)**
