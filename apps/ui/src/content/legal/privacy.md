---
id: "2"
slug: "privacy"
date: "2026-06-11"
title: "Privacy Policy"
description: "Read LLM Gateway’s Privacy Policy to understand how we collect, use, share, and protect your data, our roles as controller and processor, AI provider routing, your GDPR and CCPA rights, data retention, and international transfers."
---

# Privacy Policy

**Effective Date:** October 21, 2025  
**Last Updated:** June 11, 2026

LLM Gateway (“we”, “our”, or “us”) provides a unified AI gateway platform that enables users to connect, manage, and analyze AI models across multiple providers. This Privacy Policy explains how we collect, use, share, and protect personal information when you use our website, APIs, SDKs, dashboards, and related services (collectively, the “Service”).

This Policy is incorporated into and subject to our [Terms of Use](https://llmgateway.io/terms). Capitalized terms not defined here have the meaning given in the Terms.

---

## 1. Our Role: Controller and Processor

Our role depends on the data involved:

- **As a controller.** For account, billing, website, and usage-analytics data, we determine the purposes and means of processing and act as the **data controller**.
- **As a processor / service provider.** For the prompts, inputs, and content you submit to be routed to AI providers (“Customer Data”), we act as a **processor** (under GDPR) and a **service provider** (under the CCPA) on your behalf. You are responsible, as controller, for the Customer Data you submit and for having a lawful basis to submit it. Enterprise customers may enter into a separate **Data Processing Addendum (DPA)** that governs this processing; where a signed DPA exists, it controls over this Policy with respect to Customer Data.

We **do not use Customer Data (your prompts, inputs, or the responses returned to you) to train any models.** Customer Data is processed solely to provide the Service and according to your retention settings.

---

## 2. Information We Collect

### a. Account Information

When you register, we collect your **name**, **email address**, and **organization details**. For paid and enterprise users, we may also collect billing details such as company name, address, and payment information (processed securely via **Stripe**).

### b. Usage Data

We automatically collect technical and usage information when you use the Service, including:

- IP address, browser type, and device information
- Log data, API requests, and timestamps
- Model usage statistics (e.g., provider name, tokens used, latency, and cost)

### c. AI Request Data (Customer Data)

Depending on your **data retention settings**, we may store:

- **Retain All Data:** Request payloads and responses with metadata
- **Metadata Only:** Usage, pricing, and provider statistics (excluding request content)

You can configure this under **Settings → Policies** in your organization dashboard. Regardless of setting, request content is transmitted to the AI provider you select in order to fulfill the request (see [Data Sharing](#5-data-sharing)).

### d. Payment Information

We use **Stripe** to process payments. Your payment data is handled by Stripe under their [Privacy Policy](https://stripe.com/privacy). **We do not store your full credit card information.**

### e. Cookies and Analytics

We use cookies and similar technologies to operate the site, analyze usage, and improve the Service. You can control cookies through your browser settings; some features may not function without them.

---

## 3. Legal Bases for Processing (EU/UK)

Where the GDPR or UK GDPR applies, we rely on the following legal bases:

- **Performance of a contract** — to provide the Service, manage your account, and process payments.
- **Legitimate interests** — to secure, maintain, analyze, and improve the Service and prevent abuse, balanced against your rights.
- **Legal obligation** — to retain billing and tax records and respond to lawful requests.
- **Consent** — for optional marketing communications and non-essential cookies, which you may withdraw at any time.

---

## 4. How We Use Your Information

We use your data to:

- Provide, maintain, secure, and improve the Service
- Authenticate and manage your account
- Monitor API usage and enforce our acceptable use and fair use policies
- Process billing and send transactional emails
- Produce usage, performance, and product analytics
- Communicate updates, security alerts, and (where permitted) promotions

We do **not** sell your personal information, and we do **not** use Customer Data to train AI models.

---

## 5. Data Sharing

We do **not sell** your personal information. We share limited data only as needed with:

- **Service Providers / Sub-processors:** for hosting, analytics, payments, and email (see below).
- **AI Providers:** when routing your API requests to the model you select (e.g., OpenAI, Anthropic, Google, Mistral, and others). Once your request reaches a provider, that provider processes it under **its own terms, privacy policy, and data-training practices**, which vary by provider and which we do not control. You can review each provider's terms, privacy policy, headquarters, certifications, and AI-training and data-retention practices on our [Providers page](https://llmgateway.io/providers) before selecting a model.
- **Legal Authorities:** only where required by law or to protect our rights, users, or the public.
- **Business transfers:** in connection with a merger, acquisition, financing, or sale of assets, subject to this Policy.

### Sub-processors

We rely on a small set of vetted sub-processors, each bound by contractual data-protection obligations:

- **Stripe** — payment and subscription processing. Stripe acts as a separate processor and retains its own payment records to meet its legal and tax obligations, under their [Privacy Policy](https://stripe.com/privacy).
- **Google Cloud** — application hosting and database storage
- **Resend** — transactional and product email delivery
- **AI Providers** — as listed on our [Providers page](https://llmgateway.io/providers), when routing your requests

---

## 6. Team and Organization Management

If you belong to an organization:

- Owners and Admins can view and manage member data and roles.
- Access is limited by assigned roles (Owner, Admin, Developer, Restricted Access).

You can manage permissions from the **Team** page. Your organization is responsible for the personal data it processes through the Service and for the lawfulness of the Customer Data it submits.

---

## 7. Data Retention

We keep personal data only as long as necessary for the purposes it was collected, or as required by law:

- **Account and profile data** (name, email, login credentials, API keys): retained while your account is active; deleted promptly when you delete your account.
- **AI request content and metadata:** request and response content is governed by your organization's retention setting (Retain All Data vs Metadata Only); aggregated usage and cost metadata is retained for analytics and billing accuracy.
- **Billing and accounting records** (purchases of credits, payments, invoices, and the transaction history of credits bought and spent): retained for **10 years** to comply with applicable tax and accounting law, even after account deletion, after which they are deleted or anonymized.

Where we retain billing records after account deletion, we restrict processing of that data to what the law requires and anonymize personal identifiers not needed for the accounting record.

---

## 8. Security

We implement industry-standard technical and organizational measures to protect personal data, including:

- HTTPS and encryption in transit
- Access controls and authentication for sensitive data
- Regular security reviews and monitoring

No system is completely secure, and we cannot guarantee absolute security. You are responsible for safeguarding your account credentials and API keys. If we become aware of a personal-data breach affecting you, we will notify you and any relevant authorities as required by applicable law.

---

## 9. Your Privacy Rights

Depending on your location, you may have the right to:

- Access, correct, or delete your personal data
- Export your data in a machine-readable format (portability)
- Withdraw consent for specific processing activities
- Object to or restrict certain processing activities

You can exercise these rights by emailing **[contact@llmgateway.io](mailto:contact@llmgateway.io)**. We will respond within the timeframe required by applicable law and may need to verify your identity first. You will not be discriminated against for exercising your rights.

### EU/UK (GDPR)

If you are in the EU/EEA or UK, you may exercise the rights above and **lodge a complaint with your local data protection supervisory authority**. International transfers of your data are safeguarded as described in [Section 11](#11-international-transfers).

### California (CCPA/CPRA)

If you are a California resident, you have the right to know, access, delete, and correct your personal information, and to opt out of its sale or sharing. **We do not sell or share personal information** as those terms are defined under the CCPA/CPRA, and we do not use it for cross-context behavioral advertising. We act as a **service provider** with respect to Customer Data processed on our customers' behalf. To exercise your rights, contact us at the email above; you may use an authorized agent.

### Limits on the right to erasure

We will honor erasure requests except where we are legally obliged to retain data. In particular, **records of credits you purchased and spent** are kept to comply with tax and accounting law (see [Data Retention](#7-data-retention)) and cannot be deleted on request during the statutory retention period. During that period we limit our processing of those records to what the law requires. Once the period ends, the data is deleted or anonymized.

---

## 10. AI Providers and Your Data

When you route a request, the **content of that request is sent to the AI provider you select** so it can generate a response. Each provider handles data under its own policies, which differ in retention, sub-processing, geographic location, certifications (e.g., SOC 2, ISO 27001), and whether they use inputs for model training. We do not control those practices.

Before selecting a model, we encourage you to review the provider's policies on our [Providers page](https://llmgateway.io/providers), which links to each provider's terms, privacy policy, and data-training and compliance information. You are responsible for ensuring your selected provider is appropriate for the sensitivity of the data you submit.

---

## 11. International Transfers

Data may be processed and stored on servers located in the **European Union or the United States**, and may be transferred to AI providers and sub-processors in other countries. Where we transfer personal data internationally, we use appropriate safeguards required by applicable law, such as the **Standard Contractual Clauses (SCCs)** or equivalent mechanisms, to protect your data.

---

## 12. Children’s Privacy

The Service is **not intended for or directed to individuals under 18 years of age**, consistent with our [Terms of Use](https://llmgateway.io/terms). We do not knowingly collect personal information from anyone under 18. If you believe a minor has provided us personal information, contact us and we will delete it.

---

## 13. Changes to This Policy

We may update this Privacy Policy periodically. The latest version will always be available on our [Privacy Policy page](https://llmgateway.io/privacy), with an updated “Last Updated” date. For **material changes**, we will provide reasonable notice (for example, by email or in-product notice). Your continued use of the Service after the changes take effect constitutes acceptance of the updated Policy.

---

## 14. Contact Us

If you have any questions about this Privacy Policy or your data, or wish to exercise your rights, contact us at:  
📧 **[contact@llmgateway.io](mailto:contact@llmgateway.io)**  
🌐 **[llmgateway.io](https://llmgateway.io)**
