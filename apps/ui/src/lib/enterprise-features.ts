export interface EnterpriseFeatureDefinition {
	slug: string;
	title: string;
	subtitle: string;
	tagline: string;
	description: string;
	longDescription: string;
	iconName:
		| "shield-check"
		| "badge-check"
		| "git-branch"
		| "audit"
		| "bell"
		| "lock"
		| "paintbrush";
	accent: "indigo" | "amber" | "emerald" | "rose" | "sky" | "violet";
	keywords: string[];
	benefits: Array<{ title: string; description: string }>;
	useCases: Array<{ title: string; description: string }>;
	howItWorks: Array<{ step: string; title: string; description: string }>;
	faq: Array<{ question: string; answer: string }>;
	codeExample?: { title: string; language: string; code: string };
}

export const enterpriseFeatures: EnterpriseFeatureDefinition[] = [
	{
		slug: "audit-logs",
		title: "Enterprise Audit Logs",
		subtitle: "Every action, attributed and immutable",
		tagline: "Trace any change back to a person, a minute, and an IP.",
		description:
			"Tamper-evident audit trails for SOC 2, HIPAA, ISO 27001, and internal investigations. Every config change, key rotation, and admin action — captured, attributed, exportable.",
		longDescription:
			"Enterprise Audit Logs sit underneath every privileged action in LLM Gateway. When an admin rotates a provider key, removes a teammate, changes routing config, or downloads logs — it lands in an append-only audit stream with the actor, timestamp, IP, user-agent, and a structured diff of before/after state. Logs are filterable by user, resource, action, or time, exportable as CSV/JSON, and forwardable to your SIEM (Splunk, Datadog, Elastic) via webhook. Retention defaults to forever for enterprise plans.",
		iconName: "audit",
		accent: "indigo",
		keywords: [
			"LLM audit logs",
			"SOC 2 LLM gateway",
			"HIPAA audit trail AI",
			"AI compliance logs",
			"enterprise AI governance",
		],
		benefits: [
			{
				title: "Append-only by design",
				description:
					"Audit rows can't be edited or deleted from the dashboard — even by org owners. Cryptographic chaining detects tampering at the storage layer.",
			},
			{
				title: "Actor + resource + diff",
				description:
					"Every event records who, what, when, where, and a structured before/after diff — not just an action name.",
			},
			{
				title: "SIEM forwarding",
				description:
					"Stream audit events to Splunk, Datadog, Elastic, or any HTTPS endpoint. Replay any window on demand.",
			},
			{
				title: "Compliance-ready exports",
				description:
					"One-click CSV/JSON exports scoped to a date range, user, or resource — formatted for SOC 2 and HIPAA auditors.",
			},
		],
		useCases: [
			{
				title: "Security investigations",
				description:
					"A key was rotated at 3:14 UTC. Who did it, from which IP, and what did the request look like? One query.",
			},
			{
				title: "SOC 2 / HIPAA evidence",
				description:
					"Hand your auditor a scoped export with full attribution — no screenshots, no reconstruction.",
			},
			{
				title: "Insider-risk monitoring",
				description:
					"Alert when admins access prod keys outside working hours or from unfamiliar geographies.",
			},
		],
		howItWorks: [
			{
				step: "01",
				title: "Enable on your org",
				description:
					"Audit logging is enabled on every enterprise org by default. No code changes — every privileged route is already instrumented.",
			},
			{
				step: "02",
				title: "Query in the dashboard",
				description:
					"Filter by user, action, resource, or time range. Each row expands into the full structured diff.",
			},
			{
				step: "03",
				title: "Forward to your SIEM",
				description:
					"Add a webhook URL in org settings. Events are POSTed in real time with retries and signed payloads.",
			},
		],
		faq: [
			{
				question: "How long are audit logs retained?",
				answer:
					"Enterprise plans get unlimited retention by default. We do not auto-prune. You can export and delete on your own schedule if needed for data-residency.",
			},
			{
				question: "Can audit logs be deleted?",
				answer:
					"No — not by org owners, not by admins, not by support. Logs are append-only in storage. The only way to remove an entry is a full org-data deletion under our DPA.",
			},
			{
				question: "Do audit logs include LLM request bodies?",
				answer:
					"Audit logs capture privileged-action metadata, not user prompts. Prompt/response logging is a separate setting under Activity Logs, which you control independently.",
			},
		],
	},
	{
		slug: "routing-overrides",
		title: "Per-Project Routing Overrides",
		subtitle: "Different rules for different teams, in the same org",
		tagline: "Pin production to one region. Let staging fall back to anything.",
		description:
			"Override global routing rules at the project level — region, provider order, fallback chain, and cost ceilings. Production stays pinned; experimental teams stay flexible.",
		longDescription:
			"Most teams need one routing config for production, another for internal tools, and a third for experimentation. Per-Project Routing Overrides let you set defaults at the organization level and selectively override them on individual projects. Pin your billing-system project to a single US region for SOC 2 scope. Let your research project fall back to whatever provider is cheapest right now. Override fallback ordering, region locks, cost ceilings, and model allow-lists — all from a structured config that's auditable, diffable, and version-controlled.",
		iconName: "git-branch",
		accent: "amber",
		keywords: [
			"LLM routing per project",
			"AI gateway region routing",
			"enterprise LLM routing",
			"AWS Bedrock region routing",
			"multi-region LLM",
		],
		benefits: [
			{
				title: "Project-scoped config",
				description:
					"Every project inherits the org default and can override any rule — region, provider priority, fallback chain, cost limits.",
			},
			{
				title: "Region pinning",
				description:
					"Lock a project to specific AWS / GCP / Azure regions for residency, latency, or compliance scope.",
			},
			{
				title: "Per-project cost ceilings",
				description:
					"Cap monthly spend per project. Auto-pause or auto-downgrade when a project's budget is hit — production is never starved by a runaway experiment.",
			},
			{
				title: "Diffable + audited",
				description:
					"Every override change is captured by [[audit-logs]] with a structured before/after diff. Roll back to any prior config in one click.",
			},
		],
		useCases: [
			{
				title: "SOC 2 scope reduction",
				description:
					"Keep your audit-scope project pinned to us-east-1 with a single approved provider. Everything outside that scope is free to roam.",
			},
			{
				title: "Multi-team isolation",
				description:
					"Research, engineering, and customer-facing apps share an org but route independently — and bill independently.",
			},
			{
				title: "Cost-aware experimentation",
				description:
					"Cap experimental projects at $200/mo so a runaway agent loop can't burn the production budget overnight.",
			},
		],
		howItWorks: [
			{
				step: "01",
				title: "Set org-wide defaults",
				description:
					"Configure global routing rules — preferred providers, fallback order, region preferences, model allow-list.",
			},
			{
				step: "02",
				title: "Override on the project",
				description:
					"In any project's Routing tab, override any subset of the org defaults. Inherited values stay live; overridden values take precedence.",
			},
			{
				step: "03",
				title: "Inspect the effective config",
				description:
					"The Effective Config view shows the merged result for any project — what's inherited, what's overridden, and why.",
			},
		],
		faq: [
			{
				question: "Can a project completely diverge from the org default?",
				answer:
					"Yes. Every field is independently overridable. You can also lock specific fields at the org level to prevent project-level overrides for compliance reasons.",
			},
			{
				question: "How do region pins interact with provider failover?",
				answer:
					"Region pins are honored during failover. If you pin a project to us-east-1, the fallback chain only considers providers/regions that match — never silently routes traffic to a different geography.",
			},
		],
		codeExample: {
			title: "Project routing override",
			language: "json",
			code: `{
  "projectId": "proj_billing_prod",
  "routing": {
    "regions": ["us-east-1"],
    "providers": ["aws-bedrock", "anthropic"],
    "fallback": "fail-fast",
    "monthlyBudgetUsd": 50000,
    "onBudgetExceeded": "pause"
  }
}`,
		},
	},
	{
		slug: "guardrails",
		title: "Enterprise Guardrails",
		subtitle:
			"Block prompt injection, PII, and secrets before they hit the model",
		tagline: "Run defense before inference — on every prompt, every project.",
		description:
			"Server-side detection for prompt injection, PII, secrets, and policy violations. Configured centrally, enforced at the gateway, auditable per-request.",
		longDescription:
			"Enterprise Guardrails sit in the request path between your application and the LLM. Every prompt is screened for prompt injection attempts, jailbreak patterns, sensitive PII (PHI, financial data, identifiers), API keys, AWS credentials, and policy-violating content. Detections are configurable — block hard, redact, or pass-through with an audit annotation. Rules are managed centrally by your security team and inherited by every project. When something is blocked, the event lands in [[audit-logs]] with the matched rule, redaction diff, and original payload (encrypted, accessible only to authorized reviewers).",
		iconName: "shield-check",
		accent: "emerald",
		keywords: [
			"LLM guardrails",
			"prompt injection protection",
			"PII detection AI",
			"AI security",
			"LLM data leakage prevention",
		],
		benefits: [
			{
				title: "Prompt injection + jailbreak detection",
				description:
					"Pretrained detectors flag the well-known attack patterns; custom regex/semantic rules cover your edge cases.",
			},
			{
				title: "PII + secrets redaction",
				description:
					"Detect and redact PHI, financial data, government IDs, AWS keys, GitHub tokens, JWTs, and 40+ other classes before they leave your perimeter.",
			},
			{
				title: "Three enforcement modes",
				description:
					"Per-rule: block, redact-and-forward, or pass-through-with-flag. Tune false-positive tolerance per project.",
			},
			{
				title: "Centrally managed, project-scoped",
				description:
					"Your security team owns the rule set at the org level; project owners can opt in to stricter rules, never weaker ones.",
			},
		],
		useCases: [
			{
				title: "PHI protection for healthcare",
				description:
					"Auto-redact patient identifiers and clinical data before any request reaches a non-BAA model.",
			},
			{
				title: "Source-code secret scanning",
				description:
					"Catch AWS keys and database URLs in code-assist prompts before they're logged anywhere downstream.",
			},
			{
				title: "Customer support chatbot hardening",
				description:
					"Block prompt-injection attempts disguised as customer messages and audit every detection for tuning.",
			},
		],
		howItWorks: [
			{
				step: "01",
				title: "Pick your baseline",
				description:
					"Start with a curated baseline — Healthcare, Finance, Engineering, or Custom — and override individual rules.",
			},
			{
				step: "02",
				title: "Tune per project",
				description:
					"Enable stricter detection for high-risk projects (customer-facing, regulated data) without slowing down internal tools.",
			},
			{
				step: "03",
				title: "Monitor + iterate",
				description:
					"Every detection lands in [[audit-logs]]. Review false positives, tune thresholds, and ship updates without code changes.",
			},
		],
		faq: [
			{
				question: "Does this add latency to every request?",
				answer:
					"Detection runs in parallel with provider routing and typically adds 8–18ms p50. Heavy semantic checks can be opted-in per-project.",
			},
			{
				question: "Can guardrails be bypassed?",
				answer:
					"No — they run server-side at the gateway, not in your SDK. There's no client-side toggle. Even an org owner enabling pass-through mode creates an audit-log entry.",
			},
		],
	},
	{
		slug: "discord-notifications",
		title: "Discord & Slack Alerts",
		subtitle: "Real-time signal where your team already lives",
		tagline:
			"Sales hand-raises, security events, and SLA breaches — pushed to your channels in seconds.",
		description:
			"Native webhook integrations for Discord and Slack. Get the enterprise contact-sales form, billing events, guardrail trips, and SLA breaches in the channels your team already monitors.",
		longDescription:
			"Stop hunting through email and admin dashboards. Enterprise Discord and Slack integrations push high-signal events to dedicated channels: a prospect submitting the contact-sales form, a guardrail tripping in production, an SLA breach on a critical project, a payment failure on an enterprise account. Each event includes a deep link back into the dashboard so on-call can act in two clicks. Channels are configurable per event class — sales hand-raises go to #sales, security trips go to #security, billing events go to #finance.",
		iconName: "bell",
		accent: "sky",
		keywords: [
			"LLM gateway Discord alerts",
			"AI Slack notifications",
			"enterprise webhook alerts",
			"on-call AI infrastructure",
		],
		benefits: [
			{
				title: "Event-class routing",
				description:
					"Map each event class (sales, security, billing, SLA) to its own webhook URL. No noisy single firehose.",
			},
			{
				title: "Non-blocking delivery",
				description:
					"Webhook delivery is async with retries and exponential backoff. A flaky Discord outage never slows your gateway.",
			},
			{
				title: "Deep links into the dashboard",
				description:
					"Every alert links back to the audit log entry, billing record, or guardrail detection that triggered it.",
			},
			{
				title: "Signed payloads",
				description:
					"All webhook payloads are HMAC-signed so your endpoint can verify they originated from LLM Gateway.",
			},
		],
		useCases: [
			{
				title: "Sales hand-raise speed",
				description:
					"A prospect fills out the enterprise contact form. Your AE sees it in #sales within 5 seconds — not 15 minutes later via email.",
			},
			{
				title: "On-call escalation",
				description:
					"Guardrail trips and SLA breaches page on-call directly in #incidents with a dashboard link and severity tag.",
			},
			{
				title: "Finance visibility",
				description:
					"Enterprise payment events (new subscription, payment failure, upgrade) land in #finance for revops tracking.",
			},
		],
		howItWorks: [
			{
				step: "01",
				title: "Generate a webhook URL",
				description:
					"In Discord: server settings → integrations → new webhook. In Slack: incoming webhooks → new. Copy the URL.",
			},
			{
				step: "02",
				title: "Map events to channels",
				description:
					"In your org settings, paste the URL and select which event classes route to it. You can add multiple webhooks for different channels.",
			},
			{
				step: "03",
				title: "Verify and go live",
				description:
					"Hit Test to fire a sample event. Once it lands in your channel, the integration is live.",
			},
		],
		faq: [
			{
				question: "Are payloads signed?",
				answer:
					"Yes. Every webhook delivery includes an X-Signature header with an HMAC of the payload using your channel-specific secret.",
			},
			{
				question: "What happens if my webhook endpoint is down?",
				answer:
					"Delivery is retried with exponential backoff for 24 hours. Permanently-failed events are visible in your org settings for manual replay.",
			},
		],
	},
	{
		slug: "sso-saml",
		title: "Single Sign-On (SAML / OIDC)",
		subtitle: "Your IdP. Your access policies. Zero local passwords.",
		tagline:
			"Federate identity through Okta, Azure AD, Google Workspace, or any SAML/OIDC provider.",
		description:
			"SAML 2.0 and OIDC SSO with SCIM provisioning, group-based role mapping, and enforced-only access. No local credentials, no shared passkeys, no off-boarding gaps.",
		longDescription:
			"Federated identity for LLM Gateway: SAML 2.0 and OpenID Connect, certified for Okta, Azure AD, Google Workspace, OneLogin, JumpCloud, and any compliant IdP. SCIM 2.0 provisioning auto-creates accounts on first login and de-provisions on user removal from your directory — no manual off-boarding. Group-to-role mappings let you grant Admin / Member / Viewer based on AD groups, so access is governed entirely by your existing identity system. Enforce SSO-only mode to block password and passkey logins for your domain.",
		iconName: "lock",
		accent: "violet",
		keywords: [
			"LLM gateway SSO",
			"SAML LLM",
			"Okta AI integration",
			"Azure AD LLM",
			"enterprise AI authentication",
		],
		benefits: [
			{
				title: "Universal IdP support",
				description:
					"SAML 2.0 and OIDC: Okta, Azure AD, Google Workspace, OneLogin, JumpCloud, Auth0, and any compliant provider.",
			},
			{
				title: "SCIM auto-provisioning",
				description:
					"Users created on first login. Removed users de-provisioned within minutes via SCIM 2.0. No manual cleanup.",
			},
			{
				title: "Group-based role mapping",
				description:
					"Map IdP groups to LLM Gateway roles (Admin / Member / Viewer). Access changes the moment your directory changes.",
			},
			{
				title: "SSO-only enforcement",
				description:
					"Disable password + passkey logins for your domain. Every authentication path is your IdP — no shadow accounts.",
			},
		],
		useCases: [
			{
				title: "Zero-touch onboarding",
				description:
					"New engineer joins the AI team in Okta. They log in to LLM Gateway with their SSO; account provisions, role assigned, ready in seconds.",
			},
			{
				title: "Instant off-boarding",
				description:
					"Engineer leaves. Removed from Okta. Within minutes, their LLM Gateway session is revoked and their account de-provisioned.",
			},
			{
				title: "Audit-clean access reviews",
				description:
					"Quarterly access reviews are trivial — the source of truth is your IdP, and [[audit-logs]] records every role change.",
			},
		],
		howItWorks: [
			{
				step: "01",
				title: "Add your IdP metadata",
				description:
					"Paste your SAML metadata URL or OIDC discovery endpoint. We auto-detect endpoints and certificates.",
			},
			{
				step: "02",
				title: "Map groups to roles",
				description:
					"Create rules: `ai-admins → Admin`, `engineering → Member`, `finance → Viewer`. Multiple group memberships escalate to highest role.",
			},
			{
				step: "03",
				title: "Enforce SSO-only",
				description:
					"Toggle SSO-only mode for your verified email domain. Password and passkey logins are now blocked for that domain.",
			},
		],
		faq: [
			{
				question: "Do you support SCIM provisioning?",
				answer:
					"Yes, full SCIM 2.0. Users, groups, role assignments, and de-provisioning all flow through SCIM if your IdP supports it.",
			},
			{
				question: "What happens to existing accounts when we enable SSO-only?",
				answer:
					"Existing accounts on your domain are migrated to SSO at next login. Local credentials are deactivated; the user's data, API keys, and project memberships are preserved.",
			},
		],
	},
	{
		slug: "white-label",
		title: "White-Label Chat & Playground",
		subtitle: "Ship the LLM Gateway playground as your own product",
		tagline: "Your logo, your domain, your colors — our infrastructure.",
		description:
			"Embed or stand up a fully white-labeled chat app and playground under your own domain. Customize branding, default models, system prompts, and feature toggles.",
		longDescription:
			"The LLM Gateway playground is the same chat UI used by tens of thousands of developers — and you can ship it as your own internal tool or customer-facing product. White-label deployments run on your domain (chat.yourcompany.com), with your logo, color palette, and copy. Lock down model selection to your approved list, set default system prompts, disable features your users shouldn't see (like raw API key management), and integrate with your existing SSO. Use it as an internal AI workbench for non-technical staff, a customer-facing AI feature, or a productized AI offering — without writing the chat UI from scratch.",
		iconName: "paintbrush",
		accent: "rose",
		keywords: [
			"white label LLM chat",
			"embeddable AI playground",
			"AI chatbot SaaS",
			"OEM LLM platform",
		],
		benefits: [
			{
				title: "Your domain, your brand",
				description:
					"Custom domain, logo, favicon, color palette, and product name. No mention of LLM Gateway in the UI unless you want it.",
			},
			{
				title: "Locked-down model menu",
				description:
					"Restrict the model picker to your approved list — by provider, capability, or price tier.",
			},
			{
				title: "Pre-configured system prompts",
				description:
					"Ship with role-specific defaults: legal assistant, support agent, code reviewer. Users start in the right context.",
			},
			{
				title: "Feature flagging",
				description:
					"Hide raw API key management, advanced provider settings, or anything your end-users shouldn't see.",
			},
		],
		useCases: [
			{
				title: "Internal AI workbench",
				description:
					"Give non-technical staff a polished AI tool under your IT domain, with SSO and audit logging — without building a chat UI.",
			},
			{
				title: "Customer-facing AI feature",
				description:
					"Embed an AI assistant into your product without writing the UI, the streaming, the markdown rendering, or the model integration.",
			},
			{
				title: "Productize an AI offering",
				description:
					"Resell a branded AI chat experience to your customers, with usage-based pricing built on top of your gateway.",
			},
		],
		howItWorks: [
			{
				step: "01",
				title: "Configure branding",
				description:
					"Upload your logo, set your color palette, pick a typeface. The preview updates in real time.",
			},
			{
				step: "02",
				title: "Point your domain",
				description:
					"Set a CNAME from chat.yourcompany.com to our edge. SSL provisioning is automatic.",
			},
			{
				step: "03",
				title: "Lock features + go live",
				description:
					"Set model allow-lists, default prompts, and feature toggles. Hand out access via SSO and ship.",
			},
		],
		faq: [
			{
				question: "Can we self-host the white-label?",
				answer:
					"Yes. Enterprise plans include the option to deploy the playground container into your own infrastructure with branding baked in.",
			},
			{
				question: "Does white-label work with our SSO?",
				answer:
					"Yes. The white-labeled deployment uses your [[sso-saml]] configuration so users authenticate against your IdP, not a separate LLM Gateway account.",
			},
		],
	},
	{
		slug: "compliance",
		title: "Provider Compliance Policies",
		subtitle: "Only route to providers you're allowed to use",
		tagline:
			"Block non-compliant providers before any data leaves the gateway.",
		description:
			"Define the certifications and data policies your providers must meet — SOC 2, ISO 27001, GDPR, no prompt training, no prompt logging — and the gateway refuses to route to anything that doesn't qualify.",
		longDescription:
			"Provider Compliance Policies turn a procurement requirement into an enforced guardrail. Pick the attributes you require and the gateway evaluates every provider against your policy on each request. Non-compliant providers are removed from automatic routing, and a request pinned to one (e.g. deepseek/deepseek-v3.2) is rejected with a 403 — before any prompt is sent upstream. Every requirement is fail-closed: a provider qualifies only if its published data policy explicitly satisfies it, so unknown attributes never slip through. The settings page previews exactly which providers are allowed and blocked under the current policy, and every block is recorded as a security event for review.",
		iconName: "badge-check",
		accent: "indigo",
		keywords: [
			"SOC 2 LLM provider",
			"ISO 27001 AI gateway",
			"GDPR LLM compliance",
			"no training on prompts",
			"AI vendor compliance policy",
		],
		benefits: [
			{
				title: "Certification-based routing",
				description:
					"Require SOC 2, ISO 27001 (or either), and GDPR. Providers without the certifications you mandate are never used.",
			},
			{
				title: "Data-handling guarantees",
				description:
					"Require providers that don't train on prompts and don't log them — enforced on every request, not just documented.",
			},
			{
				title: "Fail-closed by default",
				description:
					"A provider qualifies only if its data policy explicitly meets each requirement. Unknown attributes are treated as non-compliant.",
			},
			{
				title: "Blocked, with a paper trail",
				description:
					"Non-compliant requests return a clear 403 and are recorded as security events so admins can see what was rejected and why.",
			},
		],
		useCases: [
			{
				title: "Regulated industries",
				description:
					"Insurance, healthcare, and finance teams that may only use providers holding specific certifications.",
			},
			{
				title: "Data-residency and privacy mandates",
				description:
					"Guarantee prompts never reach a provider that trains on or logs them.",
			},
			{
				title: "Vendor allow-lists without manual policing",
				description:
					"Encode your approved-vendor bar once; the gateway enforces it on every request across all projects.",
			},
		],
		howItWorks: [
			{
				step: "01",
				title: "Enable a policy",
				description:
					"Under Settings → Compliance, turn on the policy and toggle the certifications and data policies you require.",
			},
			{
				step: "02",
				title: "Preview the impact",
				description:
					"The settings page shows exactly which providers would be allowed and which blocked under the current policy.",
			},
			{
				step: "03",
				title: "Enforced on every request",
				description:
					"The gateway filters providers per request and blocks anything non-compliant with a 403, logging a security event.",
			},
		],
		faq: [
			{
				question: "What happens to a request that can't meet the policy?",
				answer:
					"It's blocked with a 403 explaining the policy before any data is sent upstream, and recorded as a security event. This applies to both automatic routing and pinned providers.",
			},
			{
				question: "How is provider compliance determined?",
				answer:
					"Each provider carries published data-policy metadata (SOC 2, ISO 27001, GDPR, prompt training, prompt logging). A provider qualifies only if that metadata explicitly satisfies every requirement you enable — unknown attributes fail closed.",
			},
			{
				question: "Who can manage the policy?",
				answer:
					"Organization owners and admins on the Enterprise plan. See also [[audit-logs]] and [[guardrails]].",
			},
		],
	},
];

export function getEnterpriseFeatureBySlug(
	slug: string,
): EnterpriseFeatureDefinition | undefined {
	return enterpriseFeatures.find((f) => f.slug === slug);
}
