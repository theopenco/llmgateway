---
id: "3"
slug: "sub-processors"
date: "2026-08-19"
title: "Sub-processors"
description: "The complete, versioned list of sub-processors LLM Gateway uses to provide the Service, what each one processes, where it is located, and how we notify customers before the list changes."
---

# Sub-processor List

**Version:** 2026-08-19  
**Last Updated:** August 19, 2026

This page is the authoritative list of the sub-processors LLM Gateway engages to provide the Service. It is referenced by our [Privacy Policy](/legal/privacy) and by the Data Processing Addendum (DPA) we enter into with Enterprise customers.

A **sub-processor** is a third party we engage to process personal data on behalf of our customers. Each is engaged only for the purpose described below, and we require each to be bound by a written agreement imposing data-protection obligations no less protective than our own.

---

## 1. Operational Sub-processors

These sub-processors are engaged for every customer, regardless of which AI models you route to.

| Sub-processor                                          | Purpose                                                | Data processed                                                                                                         | Primary processing location   |
| ------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **Stripe, Inc.**                                       | Payment, subscription and invoice processing           | Name, billing address, billing email, tax identifiers, payment-method metadata, transaction history                    | United States, European Union |
| **Google Cloud (Google LLC / Google Cloud EMEA Ltd.)** | Application hosting, database, object storage, tracing | All platform data — account records, usage metadata, and (where retention is enabled) request and response content     | European Union, United States |
| **Resend (Plus Five Five, Inc.)**                      | Transactional and product email delivery               | Email address, name, and the contents of the emails we send you (invoices, usage alerts, security and product notices) | United States                 |
| **PostHog, Inc.**                                      | Product analytics and feature flags                    | Account identifier, email address, IP address, page views, in-product events and usage patterns                        | United States                 |

We do not engage sub-processors for advertising, profiling, or the sale or sharing of personal information. We do not sell personal data.

---

## 2. AI Provider Sub-processors

When you route a request, its content is transmitted to the AI provider serving the model you selected, so that provider can generate a response. Those providers act as sub-processors for that request.

Because the provider catalogue changes continuously as models are added, deprecated and repriced, we do not reproduce it here — a copy in this document would be out of date within days. The **live, authoritative list is published on our [Provider Information page](/legal/providers)**, which shows, for every publicly identified provider we route to:

- its contracting entity, legal terms, privacy policy and usage policy,
- its headquarters and available processing regions,
- its data-retention window,
- whether it uses API inputs for model training,
- and its published certifications (for example SOC 2 or ISO 27001).

**You choose which of these sub-processors process your data.** No AI provider receives your request unless you select a model it serves, or enable automatic routing. Two controls let you constrain this:

- **Provider pinning** — address a model as `provider/model` to send it to exactly one provider, and send the `x-no-fallback: true` header to prevent failover to any other.
- **Compliance policies** — Enterprise customers can restrict routing by the provider's published compliance and data-handling posture. Requests that cannot be served by a compliant provider are rejected rather than silently routed elsewhere. Configure this under **Compliance** in your organization dashboard.

### Undisclosed ("stealth") providers

Some providers serve preview or unreleased models under confidentiality and their identity is not disclosed to us or to you. These are listed on the Provider Information page under their pseudonymous names. As stated in our [Privacy Policy](/legal/privacy), we cannot verify or guarantee their data-handling practices, and we do not represent that they meet the standards the named providers do.

**If you process personal data, or data subject to the GDPR, you should not rely on undisclosed providers.** Pin your requests to named providers, or use a compliance policy that excludes providers without a published data policy.

---

## 3. Changes to This List

We notify customers **at least 30 days before** a new sub-processor in Section 1 begins processing personal data, giving you time to object.

That notice period applies to the operational sub-processors in Section 1. It does **not** apply to the AI providers in Section 2: those are added continuously, and none of them receives your data unless you select a model it serves or leave automatic routing enabled. Customers who need advance notice for AI providers should use a compliance policy or provider pinning, which turn provider selection into an explicit allowlist under your control.

To receive sub-processor change notices, email **[contact@llmgateway.io](mailto:contact@llmgateway.io)** and ask to be added to the sub-processor notification list.

### Objecting to a sub-processor

If you object to a new sub-processor on reasonable data-protection grounds, email us within the notice period. We will work with you to make the Service available without that sub-processor where technically feasible. If we cannot, you may terminate the affected part of the Service and receive a pro-rated refund of any prepaid fees for the unused term.

---

## 4. International Transfers

Personal data may be transferred outside the EEA and the UK to the sub-processors above and to the AI providers you select.

**The safeguard in place depends on which one.** For the operational sub-processors in Section 1, the applicable agreements incorporate the **EU Standard Contractual Clauses** (and the UK International Data Transfer Addendum where applicable), alongside supplementary technical measures including encryption in transit.

For the AI providers in Section 2, this is **provider-specific and in several cases unresolved**. A number of providers we can route to are headquartered in countries with no adequacy decision, and we do not have SCCs executed with them. We are not representing that an Article 46 safeguard is in place for every provider, because it is not.

**If you are routing personal data of EU or UK data subjects, send it only to providers whose documented safeguard you have reviewed and accepted.** The Provider Information page shows each provider's headquarters and GDPR posture. Provider pinning and compliance policies let you enforce routing restrictions rather than rely on convention.

---

## 5. Contact

Questions about this list, requests for our DPA, or sub-processor objections:  
📧 **[contact@llmgateway.io](mailto:contact@llmgateway.io)**
