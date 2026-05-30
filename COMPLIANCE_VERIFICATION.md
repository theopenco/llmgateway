# Provider Compliance Verification Sources

This file contains links to official sources for each provider's compliance certifications. Use these to manually verify the SOC 2, ISO 27001, and GDPR status set in `packages/models/src/providers.ts`.

---

## With Confirmed Compliance Data

### 1. OpenAI
- **SOC 2 Type 2** ✅ | **ISO 27001** ✅ | **GDPR** ✅
- Trust Portal: https://trust.openai.com/
- Enterprise Privacy: https://openai.com/enterprise-privacy
- Business data page: https://openai.com/business-data

### 2. Anthropic
- **SOC 2 Type 2** ✅ | **ISO 27001** ✅ | **GDPR** ✅
- Trust Center: https://trust.anthropic.com/
- Privacy Center FAQ: https://privacy.claude.com/en/articles/10015870-what-certifications-has-anthropic-obtained

### 3. Google (Vertex AI)
- **SOC 1/2/3** ✅ | **ISO 27001** ✅ | **GDPR** ✅
- Compliance: https://cloud.google.com/security/compliance
- Trust Center: https://cloud.google.com/security

### 4. AWS Bedrock
- **SOC 1/2/3** ✅ | **ISO 27001** ✅ | **GDPR** ✅
- Compliance Center: https://aws.amazon.com/compliance/
- SOC page: https://aws.amazon.com/compliance/soc-faqs/

### 5. Azure
- **SOC 1/2/3** ✅ | **ISO 27001** ✅ | **GDPR** ✅
- Trust Center: https://learn.microsoft.com/en-us/azure/compliance/
- Azure compliance docs: https://learn.microsoft.com/en-us/azure/compliance/offerings/

### 6. Meta (Llama)
- **SOC 2 Type 2** ✅ | **GDPR** ✅
- Security page: https://developers.facebook.com/docs/development/trust-center/

### 7. Mistral
- **SOC 2 Type II** ✅ | **ISO 27001** ✅ | **GDPR** ✅
- Trust Center: https://trust.mistral.ai/
- Resources (SOC 2, ISO 27001 certs): https://trust.mistral.ai/resources

### 8. Cohere
- **SOC 2 Type 2** ✅ | **ISO 27001** ✅ | **GDPR** ✅
- Trust Center: https://trustcenter.cohere.com/
- Enterprise Data: https://cohere.com/enterprise-data-commitments

### 9. Together AI
- **SOC 2 Type 2** ✅ | **GDPR** ✅
- Trust Center: https://trust.together.ai/
- SOC 2 blog: https://www.together.ai/blog/soc-2-compliance

### 10. Fireworks AI
- **SOC 2 Type 2** ✅ | **ISO 27001** ✅ | **GDPR** ✅
- Trust Center: https://trust.fireworks.ai/
- SOC 2 blog: https://fireworks.ai/blog/fireworks-ai-achieves-soc-2-type-ii-and-hipaa-compliance

### 11. Groq
- **SOC 2 Type II** ✅ | **GDPR** ✅
- Trust Center: https://trust.groq.com/
- GroqCloud security page: https://groq.com/groqcloud (scroll to "Secure by Default" section)
- Community FAQ: https://community.groq.com/t/is-groq-soc-2-compliant/82

### 12. Cerebras
- **SOC 2 Type 2** ✅ | **GDPR** ✅
- Trust Center: https://trust.cerebras.ai/

### 13. xAI (Grok)
- **SOC 2 Type 2** ✅ | **GDPR** ✅
- xAI Docs - Security FAQ: https://docs.x.ai/developers/faq/security
  (Search for "Is xAI GDPR and SOC II compliant?" — answer: "We are SOC 2 Type 2 compliant")
- Trust Center: https://trust.x.ai/
- Hoag Law analysis: https://hoaglaw.ai/resources/ai-privacy-guide/grok-xai-x

### 14. Perplexity
- **SOC 2 Type 2** ✅ | **GDPR** ✅
- Trust Center: https://trust.perplexity.ai/
- Security page: https://perplexity.ai/hub/security
- Enterprise page: https://perplexity.ai/enterprise

### 15. Nebius
- **SOC 2 Type II** ✅ | **ISO 27001** ✅
- Trust Center: https://nebius.com/trust-center
- Blog announcement: https://nebius.com/blog/posts/soc-2-type-ii-hipaa-iso-27001-enterprise-security-standards

### 16. DeepInfra
- **SOC 2** ✅ | **ISO 27001** ✅ | **GDPR** ✅ (in progress/per GDPR ready)
- Trust Center: https://trust.deepinfra.com/
- LinkedIn announcement: https://www.linkedin.com/posts/deep-infra_deepinfra-soc2-iso27001-activity-7343064606543593474-KSrA

### 17. Inference.net
- **SOC 2 Type II** ✅
- Trust Center: https://trust.inference.net/

### 18. ByteDance (Volcengine / Doubao)
- **SOC 2** ✅
- Volcengine SOC audit documentation: https://www.volcengine.com/docs/63463/913674

---

## No Confirmed Certifications Found

These providers were researched but no publicly available SOC 2, ISO 27001, or GDPR compliance documentation was found:

| Provider | Notes |
|----------|-------|
| **DeepSeek** | FAQ mentions "supports cooperation with customers on various security certification audits, including ISO 27001, SOC 2" — implies willingness to undergo audits, not holding certs |
| **NovitaAI** | No trust center, compliance page, or certification claims found |
| **EmberCloud** | No trust center, compliance page, or certification claims found |
| **Moonshot AI (Kimi)** | GitHub issue #30 confirms no SOC 2/ISO 27001 currently |
| **Z AI (Zhipu AI)** | Chinese company; no international compliance certifications found |
| **Xiaomi (MiMo)** | Part of Xiaomi group; no independent compliance documentation for MiMo found |
| **NanoGPT** | Very small operation (2 employees); no compliance documentation found |
| **Glacier** | First-party/generic; no compliance data |
| **Quartz** | First-party/generic; no compliance data |
| **Avalanche** | First-party/generic; no compliance data |

---

## LLM Gateway (First-party)
- **SOC 2** ❌ (local/self-hosted, not applicable)
- **ISO 27001** ❌
- **GDPR** ❌
