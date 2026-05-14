# Provider Compliance & Trust Documentation - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add compliance and trust documentation (terms URL, privacy policy URL, certifications, data policy, additional links) to each LLM provider definition, sync to DB, and display on the provider detail page.

**Architecture:** Extend the existing `ProviderDefinition` interface in `packages/models/src/providers.ts` with a `compliance` field. Add corresponding columns to the `provider` DB table. Extend the worker sync and API response. Add a new UI section on `/providers/[id]`.

**Tech Stack:** TypeScript, Drizzle ORM (PostgreSQL), Hono API, Next.js (React Server Components), Tailwind CSS

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/models/src/providers.ts` | Modify | Add `Certification` type, `ProviderCompliance` interface, `compliance` field to `ProviderDefinition`, populate all providers |
| `packages/db/src/schema.ts` | Modify | Add compliance columns to `provider` table |
| `apps/worker/src/services/sync-models.ts` | Modify | Sync compliance fields in upsert |
| `apps/api/src/routes/internal-models.ts` | Modify | Add compliance fields to `providerSchema` response |
| `apps/ui/src/lib/fetch-models.ts` | Modify | Add compliance fields to `ApiProvider` interface |
| `apps/ui/src/components/providers/compliance-section.tsx` | Create | Trust & Compliance section component |
| `apps/ui/src/app/providers/[id]/page.tsx` | Modify | Render compliance section |

---

### Task 1: Add Compliance Types to Models Package

**Files:**
- Modify: `packages/models/src/providers.ts:1-52`

- [ ] **Step 1: Add `Certification` type and `ProviderCompliance` interface**

Add these types above the `ProviderDefinition` interface:

```typescript
export type Certification =
	| "gdpr"
	| "soc2-type1"
	| "soc2-type2"
	| "iso27001"
	| "hipaa"
	| "ccpa"
	| "fedramp"
	| "pci-dss";

export interface ProviderComplianceLink {
	label: string;
	url: string;
}

export interface ProviderCompliance {
	termsUrl?: string | null;
	privacyPolicyUrl?: string | null;
	certifications?: Certification[];
	dataPolicy?: string | null;
	additionalLinks?: ProviderComplianceLink[];
}
```

- [ ] **Step 2: Add `compliance` field to `ProviderDefinition`**

Add to the `ProviderDefinition` interface:

```typescript
compliance?: ProviderCompliance;
```

- [ ] **Step 3: Commit**

```bash
git add packages/models/src/providers.ts
git commit -m "feat: add compliance types to provider definition"
```

---

### Task 2: Populate Compliance Data for All Providers

**Files:**
- Modify: `packages/models/src/providers.ts:54-609`

- [ ] **Step 1: Add compliance data to OpenAI**

```typescript
compliance: {
	termsUrl: "https://openai.com/policies/terms-of-use",
	privacyPolicyUrl: "https://openai.com/policies/privacy-policy",
	certifications: ["gdpr", "soc2-type2", "ccpa"],
	dataPolicy: "API inputs and outputs are not used to train models. Data is retained for up to 30 days for abuse monitoring, then deleted. Zero data retention is available for eligible customers.",
	additionalLinks: [
		{ label: "Data Processing Addendum", url: "https://openai.com/policies/data-processing-addendum" },
		{ label: "Enterprise Privacy", url: "https://openai.com/enterprise-privacy" },
		{ label: "Security Portal", url: "https://trust.openai.com" },
	],
},
```

- [ ] **Step 2: Add compliance data to Anthropic**

```typescript
compliance: {
	termsUrl: "https://www.anthropic.com/policies/terms-of-service",
	privacyPolicyUrl: "https://www.anthropic.com/policies/privacy",
	certifications: ["gdpr", "soc2-type2", "hipaa", "ccpa"],
	dataPolicy: "API inputs and outputs are not used to train models by default. Prompts may be retained for up to 30 days for safety evaluation, with zero retention available on request.",
	additionalLinks: [
		{ label: "Usage Policy", url: "https://www.anthropic.com/policies/usage-policy" },
		{ label: "Security Practices", url: "https://trust.anthropic.com" },
	],
},
```

- [ ] **Step 3: Add compliance data to Google AI Studio**

```typescript
compliance: {
	termsUrl: "https://policies.google.com/terms",
	privacyPolicyUrl: "https://policies.google.com/privacy",
	certifications: ["gdpr", "soc2-type2", "iso27001", "hipaa", "fedramp", "pci-dss"],
	dataPolicy: "For paid API usage, Google does not use prompts or responses to improve products. Free-tier usage may be used for model improvement. Data is processed in accordance with the Cloud Data Processing Addendum.",
	additionalLinks: [
		{ label: "Google Cloud Data Processing Terms", url: "https://cloud.google.com/terms/data-processing-addendum" },
		{ label: "AI Terms of Service", url: "https://ai.google.dev/gemini-api/terms" },
	],
},
```

- [ ] **Step 4: Add compliance data to Google Vertex AI**

```typescript
compliance: {
	termsUrl: "https://cloud.google.com/terms",
	privacyPolicyUrl: "https://policies.google.com/privacy",
	certifications: ["gdpr", "soc2-type2", "iso27001", "hipaa", "fedramp", "pci-dss"],
	dataPolicy: "Customer data is not used to train or improve models. Google Cloud's data processing terms apply. Data residency controls available.",
	additionalLinks: [
		{ label: "Cloud Data Processing Addendum", url: "https://cloud.google.com/terms/data-processing-addendum" },
		{ label: "Compliance Offerings", url: "https://cloud.google.com/security/compliance" },
	],
},
```

- [ ] **Step 5: Add compliance data to Vertex AI (Anthropic)**

```typescript
compliance: {
	termsUrl: "https://cloud.google.com/terms",
	privacyPolicyUrl: "https://policies.google.com/privacy",
	certifications: ["gdpr", "soc2-type2", "iso27001", "hipaa", "fedramp", "pci-dss"],
	dataPolicy: "Processed under Google Cloud's data processing terms. Customer prompts are not used to train models. Anthropic does not receive or retain customer data sent through Vertex AI.",
	additionalLinks: [
		{ label: "Cloud Data Processing Addendum", url: "https://cloud.google.com/terms/data-processing-addendum" },
		{ label: "Vertex AI Terms", url: "https://cloud.google.com/terms/service-terms" },
	],
},
```

- [ ] **Step 6: Add compliance data to AWS Bedrock**

```typescript
compliance: {
	termsUrl: "https://aws.amazon.com/service-terms",
	privacyPolicyUrl: "https://aws.amazon.com/privacy",
	certifications: ["gdpr", "soc2-type2", "iso27001", "hipaa", "fedramp", "pci-dss"],
	dataPolicy: "AWS does not use customer inputs or outputs to train models. Data is encrypted in transit and at rest. Customers can opt out of content logging entirely.",
	additionalLinks: [
		{ label: "Data Protection", url: "https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html" },
		{ label: "AWS Compliance Programs", url: "https://aws.amazon.com/compliance/programs" },
		{ label: "AWS Data Processing Addendum", url: "https://d1.awsstatic.com/legal/aws-dpa/aws-dpa.pdf" },
	],
},
```

- [ ] **Step 7: Add compliance data to Azure**

```typescript
compliance: {
	termsUrl: "https://www.microsoft.com/licensing/terms",
	privacyPolicyUrl: "https://privacy.microsoft.com/privacystatement",
	certifications: ["gdpr", "soc2-type2", "iso27001", "hipaa", "fedramp", "pci-dss"],
	dataPolicy: "Customer prompts and completions are not used to train, retrain, or improve models. Data is stored within the customer's selected Azure geography. Abuse monitoring with human review can be disabled for approved customers.",
	additionalLinks: [
		{ label: "Data Privacy", url: "https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy" },
		{ label: "Azure Compliance", url: "https://learn.microsoft.com/en-us/azure/compliance" },
		{ label: "Microsoft DPA", url: "https://www.microsoft.com/licensing/docs/view/Microsoft-Products-and-Services-Data-Protection-Addendum-DPA" },
	],
},
```

- [ ] **Step 8: Add compliance data to Azure AI Foundry**

```typescript
compliance: {
	termsUrl: "https://www.microsoft.com/licensing/terms",
	privacyPolicyUrl: "https://privacy.microsoft.com/privacystatement",
	certifications: ["gdpr", "soc2-type2", "iso27001", "hipaa", "fedramp", "pci-dss"],
	dataPolicy: "Customer data is not used to train base models. Azure AI Foundry inherits Azure's data protection standards and regional data residency controls.",
	additionalLinks: [
		{ label: "Azure AI Terms", url: "https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy" },
		{ label: "Azure Compliance", url: "https://learn.microsoft.com/en-us/azure/compliance" },
	],
},
```

- [ ] **Step 9: Add compliance data to Mistral AI**

```typescript
compliance: {
	termsUrl: "https://mistral.ai/terms",
	privacyPolicyUrl: "https://mistral.ai/terms/#privacy-policy",
	certifications: ["gdpr", "soc2-type2"],
	dataPolicy: "API inputs and outputs are not used for model training. Data is processed in the EU. Mistral does not store prompts or completions beyond the duration of the API call for paid plans.",
	additionalLinks: [
		{ label: "Data Processing Agreement", url: "https://mistral.ai/terms/#data-processing-agreement" },
	],
},
```

- [ ] **Step 10: Add compliance data to Groq**

```typescript
compliance: {
	termsUrl: "https://groq.com/terms-of-use",
	privacyPolicyUrl: "https://groq.com/privacy-policy",
	certifications: ["soc2-type2"],
	dataPolicy: "Groq does not use API inputs or outputs to train models. Data is processed in the US. Prompts and responses are not stored after the request completes.",
	additionalLinks: [],
},
```

- [ ] **Step 11: Add compliance data to DeepSeek**

```typescript
compliance: {
	termsUrl: "https://www.deepseek.com/terms-of-use",
	privacyPolicyUrl: "https://www.deepseek.com/privacy-policy",
	certifications: [],
	dataPolicy: "DeepSeek may use API inputs for model improvement unless opted out. Data is stored on servers in China. Retention policies are subject to Chinese data laws.",
	additionalLinks: [],
},
```

- [ ] **Step 12: Add compliance data to xAI**

```typescript
compliance: {
	termsUrl: "https://x.ai/legal/terms-of-service",
	privacyPolicyUrl: "https://x.ai/legal/privacy-policy",
	certifications: [],
	dataPolicy: "xAI may use API interactions to improve models unless otherwise agreed. Specific retention periods are not publicly documented.",
	additionalLinks: [],
},
```

- [ ] **Step 13: Add compliance data to Perplexity**

```typescript
compliance: {
	termsUrl: "https://www.perplexity.ai/hub/legal/terms-of-service",
	privacyPolicyUrl: "https://www.perplexity.ai/hub/legal/privacy-policy",
	certifications: ["soc2-type2"],
	dataPolicy: "Perplexity does not use API data to train models. Data is processed in the US.",
	additionalLinks: [],
},
```

- [ ] **Step 14: Add compliance data to Cerebras**

```typescript
compliance: {
	termsUrl: "https://cerebras.ai/terms-of-service",
	privacyPolicyUrl: "https://cerebras.ai/privacy-policy",
	certifications: ["soc2-type2"],
	dataPolicy: "Cerebras does not use customer data to train models. Inference data is not persisted after the request completes.",
	additionalLinks: [],
},
```

- [ ] **Step 15: Add compliance data to Together AI**

```typescript
compliance: {
	termsUrl: "https://www.together.ai/terms-of-service",
	privacyPolicyUrl: "https://www.together.ai/privacy-policy",
	certifications: ["soc2-type2", "gdpr"],
	dataPolicy: "Together AI does not use customer data to train models. Data is processed in the US. Prompts and outputs are not logged or stored after request completion.",
	additionalLinks: [],
},
```

- [ ] **Step 16: Add compliance data to Alibaba Cloud**

```typescript
compliance: {
	termsUrl: "https://www.alibabacloud.com/help/legal/latest/chinese-mainland-chinese",
	privacyPolicyUrl: "https://www.alibabacloud.com/help/legal/latest/chinese-mainland-chinese-privacy-policy",
	certifications: ["gdpr", "soc2-type2", "iso27001", "pci-dss"],
	dataPolicy: "Alibaba Cloud does not use customer API data for model training. Data residency varies by selected region (Singapore, US, or China). Subject to applicable local data protection laws.",
	additionalLinks: [
		{ label: "Trust Center", url: "https://www.alibabacloud.com/trust-center" },
		{ label: "Compliance", url: "https://www.alibabacloud.com/trust-center/compliance" },
	],
},
```

- [ ] **Step 17: Add compliance data to NovitaAI**

```typescript
compliance: {
	termsUrl: "https://novita.ai/legal/terms-of-service",
	privacyPolicyUrl: "https://novita.ai/legal/privacy-policy",
	certifications: [],
	dataPolicy: "NovitaAI does not use customer data for model training. Specific data retention policies are documented in their terms of service.",
	additionalLinks: [],
},
```

- [ ] **Step 18: Add compliance data to Nebius AI**

```typescript
compliance: {
	termsUrl: "https://nebius.com/legal/terms-of-service",
	privacyPolicyUrl: "https://nebius.com/legal/privacy-policy",
	certifications: ["gdpr", "iso27001"],
	dataPolicy: "Nebius AI does not use customer inputs to train models. Data is processed in EU-based data centers.",
	additionalLinks: [],
},
```

- [ ] **Step 19: Add compliance data to Moonshot AI**

```typescript
compliance: {
	termsUrl: "https://platform.moonshot.cn/docs/terms",
	privacyPolicyUrl: "https://platform.moonshot.cn/docs/privacy",
	certifications: [],
	dataPolicy: "Data is processed and stored on servers in China. Subject to Chinese data protection regulations.",
	additionalLinks: [],
},
```

- [ ] **Step 20: Add compliance data to ByteDance**

```typescript
compliance: {
	termsUrl: "https://www.byteplus.com/en/legal/terms-of-service",
	privacyPolicyUrl: "https://www.byteplus.com/en/legal/privacy-policy",
	certifications: ["gdpr", "soc2-type2", "iso27001"],
	dataPolicy: "BytePlus ModelArk does not use customer data to train models. Data processing regions depend on selected endpoint. Subject to BytePlus data processing agreement.",
	additionalLinks: [
		{ label: "Trust Center", url: "https://www.byteplus.com/en/trust-center" },
	],
},
```

- [ ] **Step 21: Add compliance data to MiniMax**

```typescript
compliance: {
	termsUrl: "https://www.minimax.io/terms-of-service",
	privacyPolicyUrl: "https://www.minimax.io/privacy-policy",
	certifications: [],
	dataPolicy: "Data is processed in China. Subject to Chinese data protection regulations.",
	additionalLinks: [],
},
```

- [ ] **Step 22: Add compliance data to Inference.net**

```typescript
compliance: {
	termsUrl: "https://inference.net/terms",
	privacyPolicyUrl: "https://inference.net/privacy",
	certifications: [],
	dataPolicy: "Inference.net does not store prompts or outputs after request completion. No data is used for model training.",
	additionalLinks: [],
},
```

- [ ] **Step 23: Add compliance data to NanoGPT**

```typescript
compliance: {
	termsUrl: "https://nano-gpt.com/terms",
	privacyPolicyUrl: "https://nano-gpt.com/privacy",
	certifications: [],
	dataPolicy: "NanoGPT acts as an aggregator routing to various providers. Data handling depends on the underlying model provider.",
	additionalLinks: [],
},
```

- [ ] **Step 24: Add compliance data to EmberCloud**

```typescript
compliance: {
	termsUrl: "https://www.embercloud.ai/terms",
	privacyPolicyUrl: "https://www.embercloud.ai/privacy",
	certifications: [],
	dataPolicy: "EmberCloud does not store prompts or outputs after request completion.",
	additionalLinks: [],
},
```

- [ ] **Step 25: Add compliance data to Xiaomi**

```typescript
compliance: {
	termsUrl: "https://platform.xiaomimimo.com/terms",
	privacyPolicyUrl: "https://platform.xiaomimimo.com/privacy",
	certifications: [],
	dataPolicy: "Data is processed in China. Subject to Chinese data protection regulations.",
	additionalLinks: [],
},
```

- [ ] **Step 26: Add compliance data to Z AI**

```typescript
compliance: {
	termsUrl: "https://z.ai/terms",
	privacyPolicyUrl: "https://z.ai/privacy",
	certifications: [],
	dataPolicy: "Z AI data retention and usage policies are documented in their terms of service.",
	additionalLinks: [],
},
```

- [ ] **Step 27: Add compliance for remaining providers (LLM Gateway, Glacier, Quartz, Avalanche, Custom)**

These internal/custom providers get minimal compliance entries:

```typescript
// llmgateway
compliance: {
	termsUrl: "https://llmgateway.io/terms",
	privacyPolicyUrl: "https://llmgateway.io/privacy",
	certifications: ["gdpr"],
	dataPolicy: "LLM Gateway routes requests to upstream providers. Request data is logged for usage tracking with configurable retention. No data is used for model training.",
	additionalLinks: [],
},

// glacier, quartz, avalanche, custom - no compliance field (undefined)
```

- [ ] **Step 28: Commit**

```bash
git add packages/models/src/providers.ts
git commit -m "feat: populate compliance data for all providers"
```

---

### Task 3: Add Compliance Columns to DB Schema

**Files:**
- Modify: `packages/db/src/schema.ts:1136-1168`

- [ ] **Step 1: Add columns to provider table**

Add after the `announcement` column (before `status`):

```typescript
termsUrl: text(),
privacyPolicyUrl: text(),
certifications: text().array(),
dataPolicy: text(),
additionalLinks: jsonb().$type<{ label: string; url: string }[]>(),
```

- [ ] **Step 2: Run schema sync**

```bash
pnpm run setup
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/
git commit -m "feat: add compliance columns to provider table"
```

---

### Task 4: Extend Worker Sync Logic

**Files:**
- Modify: `apps/worker/src/services/sync-models.ts:26-53`

- [ ] **Step 1: Add compliance fields to insert values and onConflictDoUpdate**

In the `for (const providerDef of providers)` loop, extend both `.values()` and `.onConflictDoUpdate({ set: ... })`:

```typescript
// Add to .values():
termsUrl: providerDef.compliance?.termsUrl ?? null,
privacyPolicyUrl: providerDef.compliance?.privacyPolicyUrl ?? null,
certifications: providerDef.compliance?.certifications ?? null,
dataPolicy: providerDef.compliance?.dataPolicy ?? null,
additionalLinks: providerDef.compliance?.additionalLinks ?? null,

// Add to .onConflictDoUpdate set:
termsUrl: providerDef.compliance?.termsUrl ?? null,
privacyPolicyUrl: providerDef.compliance?.privacyPolicyUrl ?? null,
certifications: providerDef.compliance?.certifications ?? null,
dataPolicy: providerDef.compliance?.dataPolicy ?? null,
additionalLinks: providerDef.compliance?.additionalLinks ?? null,
```

- [ ] **Step 2: Commit**

```bash
git add apps/worker/src/services/sync-models.ts
git commit -m "feat: sync compliance fields in provider upsert"
```

---

### Task 5: Extend API Response Schema

**Files:**
- Modify: `apps/api/src/routes/internal-models.ts:28-39`

- [ ] **Step 1: Add compliance fields to `providerSchema`**

```typescript
const providerSchema = z.object({
	id: z.string(),
	createdAt: z.coerce.date(),
	name: z.string().nullable(),
	description: z.string().nullable(),
	streaming: z.boolean().nullable(),
	cancellation: z.boolean().nullable(),
	color: z.string().nullable(),
	website: z.string().nullable(),
	announcement: z.string().nullable(),
	status: z.enum(["active", "inactive"]),
	termsUrl: z.string().nullable(),
	privacyPolicyUrl: z.string().nullable(),
	certifications: z.array(z.string()).nullable(),
	dataPolicy: z.string().nullable(),
	additionalLinks: z
		.array(z.object({ label: z.string(), url: z.string() }))
		.nullable(),
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/internal-models.ts
git commit -m "feat: add compliance fields to provider API schema"
```

---

### Task 6: Update UI ApiProvider Interface

**Files:**
- Modify: `apps/ui/src/lib/fetch-models.ts:5-16`

- [ ] **Step 1: Add compliance fields to `ApiProvider`**

```typescript
export interface ApiProvider {
	id: string;
	createdAt: string;
	name: string | null;
	description: string | null;
	streaming: boolean | null;
	cancellation: boolean | null;
	color: string | null;
	website: string | null;
	announcement: string | null;
	status: "active" | "inactive";
	termsUrl: string | null;
	privacyPolicyUrl: string | null;
	certifications: string[] | null;
	dataPolicy: string | null;
	additionalLinks: { label: string; url: string }[] | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/ui/src/lib/fetch-models.ts
git commit -m "feat: add compliance fields to ApiProvider type"
```

---

### Task 7: Create Compliance Section UI Component

**Files:**
- Create: `apps/ui/src/components/providers/compliance-section.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { ExternalLink, Shield, FileText, Lock } from "lucide-react";

import type { Certification } from "@llmgateway/models";

interface ComplianceSectionProps {
	termsUrl?: string | null;
	privacyPolicyUrl?: string | null;
	certifications?: Certification[] | null;
	dataPolicy?: string | null;
	additionalLinks?: { label: string; url: string }[] | null;
}

const certificationLabels: Record<Certification, string> = {
	gdpr: "GDPR",
	"soc2-type1": "SOC 2 Type I",
	"soc2-type2": "SOC 2 Type II",
	iso27001: "ISO 27001",
	hipaa: "HIPAA",
	ccpa: "CCPA",
	fedramp: "FedRAMP",
	"pci-dss": "PCI DSS",
};

export function ComplianceSection({
	termsUrl,
	privacyPolicyUrl,
	certifications,
	dataPolicy,
	additionalLinks,
}: ComplianceSectionProps) {
	const hasAnyData =
		termsUrl ||
		privacyPolicyUrl ||
		(certifications && certifications.length > 0) ||
		dataPolicy ||
		(additionalLinks && additionalLinks.length > 0);

	if (!hasAnyData) return null;

	return (
		<section className="py-12 bg-background border-b">
			<div className="container mx-auto px-4">
				<div className="flex items-center gap-2 mb-8">
					<Shield className="h-6 w-6 text-primary" />
					<h2 className="text-3xl font-bold">Trust & Compliance</h2>
				</div>

				<div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
					{certifications && certifications.length > 0 && (
						<div className="space-y-3">
							<h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
								Certifications
							</h3>
							<div className="flex flex-wrap gap-2">
								{certifications.map((cert) => (
									<span
										key={cert}
										className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary ring-1 ring-inset ring-primary/20"
									>
										{certificationLabels[cert as Certification] ?? cert}
									</span>
								))}
							</div>
						</div>
					)}

					{(termsUrl || privacyPolicyUrl || (additionalLinks && additionalLinks.length > 0)) && (
						<div className="space-y-3">
							<h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
								Legal & Privacy
							</h3>
							<ul className="space-y-2">
								{termsUrl && (
									<li>
										<a
											href={termsUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="inline-flex items-center gap-1.5 text-sm text-foreground hover:text-primary transition-colors"
										>
											<FileText className="h-4 w-4" />
											Terms & Conditions
											<ExternalLink className="h-3 w-3" />
										</a>
									</li>
								)}
								{privacyPolicyUrl && (
									<li>
										<a
											href={privacyPolicyUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="inline-flex items-center gap-1.5 text-sm text-foreground hover:text-primary transition-colors"
										>
											<Lock className="h-4 w-4" />
											Privacy Policy
											<ExternalLink className="h-3 w-3" />
										</a>
									</li>
								)}
								{additionalLinks?.map((link) => (
									<li key={link.url}>
										<a
											href={link.url}
											target="_blank"
											rel="noopener noreferrer"
											className="inline-flex items-center gap-1.5 text-sm text-foreground hover:text-primary transition-colors"
										>
											<ExternalLink className="h-4 w-4" />
											{link.label}
											<ExternalLink className="h-3 w-3" />
										</a>
									</li>
								))}
							</ul>
						</div>
					)}

					{dataPolicy && (
						<div className="space-y-3">
							<h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
								Data Policy
							</h3>
							<p className="text-sm text-muted-foreground leading-relaxed">
								{dataPolicy}
							</p>
						</div>
					)}
				</div>
			</div>
		</section>
	);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/ui/src/components/providers/compliance-section.tsx
git commit -m "feat: add ComplianceSection component"
```

---

### Task 8: Integrate Compliance Section into Provider Page

**Files:**
- Modify: `apps/ui/src/app/providers/[id]/page.tsx`

- [ ] **Step 1: Import and render ComplianceSection**

Add import at top:

```typescript
import { ComplianceSection } from "@/components/providers/compliance-section";
```

Insert the compliance section between `<Hero>` and the models section in the JSX:

```tsx
<Navbar />
<Hero providerId={provider.id} />

<ComplianceSection
	termsUrl={provider.compliance?.termsUrl}
	privacyPolicyUrl={provider.compliance?.privacyPolicyUrl}
	certifications={provider.compliance?.certifications}
	dataPolicy={provider.compliance?.dataPolicy}
	additionalLinks={provider.compliance?.additionalLinks}
/>

<section className="py-12 bg-background">
```

- [ ] **Step 2: Commit**

```bash
git add apps/ui/src/app/providers/[id]/page.tsx
git commit -m "feat: show compliance section on provider page"
```

---

### Task 9: Build Verification & Final Commit

- [ ] **Step 1: Run format**

```bash
pnpm format
```

- [ ] **Step 2: Run build**

```bash
pnpm build
```

- [ ] **Step 3: Fix any type errors or build issues**

Address any compilation errors from the build step.

- [ ] **Step 4: Run unit tests**

```bash
pnpm test:unit
```

- [ ] **Step 5: Final commit if any changes from formatting/fixes**

```bash
git add -A
git commit -m "chore: format and fix build issues"
```

---

### Task 10: Create Pull Request

- [ ] **Step 1: Push branch and create PR**

```bash
git push -u origin feat/provider-compliance
gh pr create --title "feat: add provider compliance & trust docs" --body "$(cat <<'EOF'
## Summary
- Adds compliance and trust documentation to each provider definition in `@llmgateway/models`
- Tracks: terms URL, privacy policy URL, certifications (GDPR, SOC2, ISO 27001, HIPAA, CCPA, FedRAMP, PCI DSS), data policy, additional links
- Syncs compliance data to DB via existing worker
- Displays Trust & Compliance section on `/providers/<id>` page

## Changes
- `packages/models/src/providers.ts` - New types + compliance data for all providers
- `packages/db/src/schema.ts` - New columns on provider table
- `apps/worker/src/services/sync-models.ts` - Sync compliance fields
- `apps/api/src/routes/internal-models.ts` - Extended API response
- `apps/ui/` - New ComplianceSection component + page integration

## Test plan
- [ ] Verify `pnpm build` passes
- [ ] Verify `pnpm test:unit` passes
- [ ] Run local dev server and check `/providers/openai` shows compliance section
- [ ] Verify providers without compliance data don't show the section
- [ ] Run `pnpm run setup` to verify DB schema syncs correctly

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
