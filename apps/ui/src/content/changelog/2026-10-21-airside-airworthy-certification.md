---
id: "116"
slug: "airside-airworthy-certification"
date: "2026-10-21"
title: "Airside: Airworthy Certification"
summary: "Airworthy (standard AW-1) is a certificate for inference providers on Airside. LLM Gateway checks each carrier's claims on training, prompt logging, retention, legal entity, headquarters and audits against contracts, registries and audit reports, then stamps the provider page with exactly what was verified."
tags: ["airside"]
image:
  src: "/changelog/airside-airworthy-certification.png"
  alt: "Airworthy AW-1 card from Airside by LLM Gateway, headlined Self-declared isn't verified, listing the data handling, jurisdiction and assurance domains as inspected"
  width: 1200
  height: 630
---

Every inference provider publishes claims about whether API data trains models, whether prompts are logged, how long they are kept and where the company operates. Until now a developer picking a provider on Airside had no way to tell which of those claims anyone had checked. **Airworthy** answers that: a certificate, issued by LLM Gateway after reviewing evidence, shown on the provider page.

## What AW-1 Inspects

Standard AW-1 has eight controls in three domains. Each claim is checked against a specific piece of evidence:

| Control | Claim                               | Evidence                                                                  |
| ------- | ----------------------------------- | ------------------------------------------------------------------------- |
| AW-1.D1 | Whether API data trains models      | Training clause in the signed DPA or terms of service                     |
| AW-1.D2 | Whether prompts are logged          | Logging scope in the DPA or privacy policy                                |
| AW-1.D3 | How long prompts are kept           | Retention period in the DPA; zero retention needs written confirmation    |
| AW-1.J1 | Which legal entity operates the API | Corporate registry extract matching the contracting party                 |
| AW-1.J2 | Where it is headquartered           | Registered address in that registry                                       |
| AW-1.A1 | SOC 2 Type I or Type II, if claimed | A current report, period ending in the last 12 months                     |
| AW-1.A2 | ISO/IEC 27001, if claimed           | The certificate, checked with the issuing body                            |
| AW-1.A3 | GDPR readiness, if claimed          | A published DPA with standard contractual clauses, or an EU establishment |

The certificate attests that a carrier's stated policy is true, whatever it is. A provider that keeps prompts for 30 days can be certified, as long as 30 days is what it says and what its DPA commits to. The registry lists the verified values so you can check them against your own requirements.

## The Stamp Stays True

- **On the provider page**: certified carriers get an Airworthy stamp on their llmgateway.io provider page, with the certificate number and the verified claims in the Data & Privacy card.
- **Public registry**: every valid certificate is listed on the Airworthy page with its number, expiry and verified training, logging and retention values.
- **Valid for 12 months**, unless revoked sooner.
- **No stale badges**: the certificate freezes the claims it attests. If a carrier changes one on its profile, the stamp comes off within a minute and only returns if the profile matches again. New values need a new inspection.

## Get Certified

Any carrier listed on Airside with a complete public profile can apply, catalogue providers and custom carriers alike. Complete your profile, request an inspection from the Airworthy page, and we will tell you which documents to send.

---

**[Read the AW-1 standard →](https://airside.llmgateway.io/airworthy)** | **[Open the carrier console →](https://airside.llmgateway.io)**
