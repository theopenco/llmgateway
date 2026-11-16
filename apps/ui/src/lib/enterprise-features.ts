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
		| "paintbrush"
		| "chart"
		| "users"
		| "workflow"
		| "eye-off"
		| "network"
		| "radio"
		| "key-round"
		| "book-open";
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
		slug: "organization-analytics",
		title: "Organization-Wide Analytics",
		subtitle: "Every project, every member, one page",
		tagline:
			"Roll spend up across the org — then break it down by model, project, key, or member.",
		description:
			"Cost, requests, and tokens totaled across every project, with breakdowns by model, project, API key, and member. Built on pre-aggregated rollups, so any date range stays fast.",
		longDescription:
			'Per-project analytics answers "where did this project\'s spend go?" — Organization Analytics does the rollup for the whole org. One page totals cost, requests, and tokens across every project for any date range, and a single group-by control pivots the cost-over-time and ranking charts by canonical model, project, or API key. Enterprise organizations also get usage broken down by person: a per-member table sorted by spend, and a detail view per member with summary cards, their top model, provider, and app, and cost-by-model breakdowns. Usage is attributed by who created each API key, every chart respects the shared date-range picker, and daily buckets follow your own timezone rather than UTC midnight. It all reads from the same pre-aggregated hourly rollups the rest of the dashboard uses — no scans over raw request logs — so it stays fast on windows up to a year.',
		iconName: "chart",
		accent: "sky",
		keywords: [
			"LLM cost analytics",
			"organization AI spend",
			"per-member LLM usage",
			"AI cost attribution",
			"LLM usage breakdown",
		],
		benefits: [
			{
				title: "Org-wide rollups",
				description:
					"Spend, requests, and tokens totaled across every project in the organization — no more opening projects one by one and adding the numbers up yourself.",
			},
			{
				title: "Pivot three ways",
				description:
					"Group the same charts by canonical model, project, or API key, each with Cost / Requests / Tokens tabs on the shared date-range picker.",
			},
			{
				title: "Per-member attribution",
				description:
					"See cost, tokens, requests, error rate, and key count per person, with a detail view of their top models, providers, and apps. Spend lands on whoever owns the key.",
			},
			{
				title: "Fast on any window",
				description:
					"Reads pre-aggregated hourly rollups instead of raw request logs, and buckets days in your own timezone — charts line up with your wall clock.",
			},
		],
		useCases: [
			{
				title: "Which team drives the bill",
				description:
					"Group by project to see which team or workload is behind this month's invoice — before finance asks.",
			},
			{
				title: "Chargeback and showback",
				description:
					"Attribute spend to members and API keys for internal cost allocation, straight from the dashboard or the API.",
			},
			{
				title: "Spotting expensive outliers",
				description:
					"Rank models by cost across the whole org to catch the experiment quietly burning budget on a frontier model.",
			},
		],
		howItWorks: [
			{
				step: "01",
				title: "Open Organization → Analytics",
				description:
					"Summary cards total spend, requests, and tokens for the selected range across all projects.",
			},
			{
				step: "02",
				title: "Pick a breakdown",
				description:
					"Switch the group-by between model, project, and API key. Every view keeps the Cost / Requests / Tokens tabs.",
			},
			{
				step: "03",
				title: "Drill into people and keys",
				description:
					"Open the Members table for per-person spend, or any API key's statistics page for cost, tokens, requests, and error rate scoped to that key.",
			},
		],
		faq: [
			{
				question: "Who can access organization analytics?",
				answer:
					"Organization owners and admins on the Enterprise plan. Non-enterprise orgs see an upgrade card, and enterprise-gated entries are marked in the sidebar so members can tell before clicking through.",
			},
			{
				question: "How is member usage attributed?",
				answer:
					"By who created each API key — spend lands on the member who owns the key. Member analytics are exposed through GET /analytics/members and GET /analytics/members/{userId}.",
			},
			{
				question: "Does it scan my request logs?",
				answer:
					"No. The page reads the same pre-aggregated hourly rollups the rest of the dashboard uses, so it stays fast across any range up to a year. Every analytics endpoint also accepts an IANA timezone parameter so daily buckets follow your local day.",
			},
		],
		codeExample: {
			title: "Daily series with a project breakdown",
			language: "bash",
			code: `GET /analytics/activity?organizationId=org_123\\
  &groupBy=project\\
  &from=2026-06-01&to=2026-06-30\\
  &timezone=Europe/Paris`,
		},
	},
	{
		slug: "member-budgets",
		title: "Per-Member Budgets & Developer Role",
		subtitle: "Give every teammate guard rails, not the whole wallet",
		tagline:
			"Cap any member's spend and keys — and scope contractors to exactly the projects you pick.",
		description:
			"Per-member spend caps enforced at request time, org-wide default developer limits, and a project-scoped Developer role. An over-budget request is rejected before it ever reaches a provider.",
		longDescription:
			"Everyone in an organization used to draw from one pool of credits with no per-person guard rails — one over-eager script could spend the whole team's budget. Per-Member Budgets give each member their own: cap how many API keys they can have active at once, their lifetime spend across all keys, and their spend per rolling hour, day, week, or month. The gateway enforces the caps at request time across chat, embeddings, OCR, speech, and video — an over-budget request is rejected with a 403 before it reaches a provider, and key creation past the cap fails with a clear 400. Org-wide default developer limits cover every developer without a personal override, and each member sees their remaining allowance on their own dashboard. The Developer role completes the picture: it grants access to exactly the projects you pick and nothing else, with a minimal dashboard scoped to the member's own usage and keys — pair it with default limits and a contractor is productive, and capped, in one invite. Spend against each cap is visible per member on the Team page alongside [[organization-analytics]].",
		iconName: "users",
		accent: "rose",
		keywords: [
			"LLM spend limits per user",
			"AI budget controls",
			"LLM API key limits",
			"AI contractor access",
			"LLM RBAC developer role",
		],
		benefits: [
			{
				title: "Enforced at request time",
				description:
					"Spend caps are checked in the gateway on every request — chat, embeddings, OCR, speech, and video. Over-budget requests return a 403 before any data reaches a provider.",
			},
			{
				title: "Three kinds of cap",
				description:
					"Max active API keys, lifetime spend across all of a member's keys, and period spend per rolling hour, day, week, or month.",
			},
			{
				title: "Default developer limits",
				description:
					"Set org-wide defaults that cover every developer without a personal override. Members see their remaining allowance on their own dashboard.",
			},
			{
				title: "Project-scoped Developer role",
				description:
					"Developers get exactly the projects you pick and a minimal dashboard with their own usage and keys — the rest of the org UI stays out of reach.",
			},
		],
		useCases: [
			{
				title: "Contractors in one invite",
				description:
					"Invite with the Developer role, scope them to one project, and let default limits cap their spend — productive and contained from day one.",
			},
			{
				title: "Runaway-script protection",
				description:
					"A rolling daily cap means an agent loop gone wrong stops at the member's limit instead of draining the team's credits overnight.",
			},
			{
				title: "Per-person accountability",
				description:
					"Admins see each member's cost, tokens, requests, and key count on the Team page — spend against each cap, per person.",
			},
		],
		howItWorks: [
			{
				step: "01",
				title: "Open Organization → Team",
				description:
					"Invites, roles, and budgets live on one page. Enterprise admins also see per-member cost, tokens, requests, and API-key columns.",
			},
			{
				step: "02",
				title: "Set budgets and defaults",
				description:
					"Use Manage budget on any row for personal caps, or set org-wide default developer limits that cover everyone without an override.",
			},
			{
				step: "03",
				title: "Scope with the Developer role",
				description:
					"Assign Developer and pick the member's projects. An info card next to the role picker spells out exactly what Owner, Admin, and Developer can do.",
			},
		],
		faq: [
			{
				question: "What happens when a member hits their cap?",
				answer:
					'Requests are rejected with a 403 ("Member has reached their total spend budget.") before reaching a provider, and creating a key past the max-active-keys cap fails with a clear 400.',
			},
			{
				question: "Which plans include this?",
				answer:
					"Per-member budgets are available to admins on every plan. The project-scoped Developer role and per-member cost columns on the Team page are Enterprise features.",
			},
			{
				question: "Can platforms see a key's remaining headroom?",
				answer:
					"Yes — the Master Keys API and the payments SDK's getBalance() report consumed usage next to the configured limits, including when the current window resets.",
			},
		],
		codeExample: {
			title: "Key usage and reset times in the API",
			language: "json",
			code: `{
  "usageLimit": "100",
  "usage": "42.13",
  "periodUsageLimit": "10",
  "currentPeriodUsage": "3.20",
  "currentPeriodResetAt": "2026-07-04T00:00:00.000Z"
}`,
		},
	},
	{
		slug: "organization-teams",
		title: "Teams & Directory Sync",
		subtitle: "One policy per team, synced from your directory",
		tagline:
			"Configure the team once. Every developer in it inherits the policy.",
		description:
			"Group developers under a shared project ceiling, per-developer budgets, and IAM rules. Microsoft Entra groups map onto teams over SCIM.",
		longDescription:
			"Setting access developer by developer stops working past a handful of people, and it drifts the moment someone changes teams. Organization Teams put developers under one shared policy: a project ceiling, per-developer budget ceilings for active keys, lifetime spend, and recurring spend, and IAM rules for models, providers, pricing, and IP ranges. Effective project access is the intersection of the team's list and each developer's own grants, and member and API-key rules run after the team's, so personal settings can only narrow what the team allows. Mark one team as the default and developers who join by invite, direct add, SSO domain auto-join, or SCIM provisioning land in it automatically. With Microsoft Entra ID, map an Entra group to a team and membership follows the directory: add a user to the group and they join the team, remove them and the synced assignment goes too. Pairs with [[sso-saml]] and [[member-budgets]].",
		iconName: "network",
		accent: "sky",
		keywords: [
			"LLM team management",
			"SCIM group provisioning",
			"Microsoft Entra SCIM",
			"AI developer access policy",
			"LLM IAM policy",
		],
		benefits: [
			{
				title: "Shared policy, not per-person setup",
				description:
					"Set the project ceiling, per-developer budgets, and IAM rules once on the team. Every developer in it inherits them.",
			},
			{
				title: "Membership from your directory",
				description:
					"Map a Microsoft Entra group to a team over SCIM. Joining or leaving the group moves the developer, with no dashboard work.",
			},
			{
				title: "A default team for new joiners",
				description:
					"Developers who join by invite, direct add, SSO domain auto-join, or SCIM land in the default team unless a group mapping places them elsewhere.",
			},
			{
				title: "Personal rules only narrow",
				description:
					"Member and API-key IAM rules run after the team's and can only restrict further, so a personal grant never widens the team's ceiling.",
			},
		],
		useCases: [
			{
				title: "Engineering groups at scale",
				description:
					"Give each group its own projects, model allow-list, and per-developer spend ceiling.",
			},
			{
				title: "Contractor access",
				description:
					"Put contractors in a team scoped to one project and a tight budget, managed from an Entra group your IT team already maintains.",
			},
			{
				title: "Zero-touch onboarding",
				description:
					"New hires provisioned over SCIM arrive in the right team with the right limits on day one.",
			},
		],
		howItWorks: [
			{
				step: "01",
				title: "Create a team",
				description:
					"Under Teams, create a team and set its project ceiling, per-developer budget ceilings, and IAM policy.",
			},
			{
				step: "02",
				title: "Assign developers",
				description:
					"Assign developers by hand, or mark the team as the default so new joiners are placed automatically.",
			},
			{
				step: "03",
				title: "Sync from Entra",
				description:
					"In SSO settings, map an Entra group name to the team. SCIM membership updates assign and remove developers for you.",
			},
		],
		faq: [
			{
				question: "Who can belong to a team?",
				answer:
					"Developers. Each developer belongs to at most one organization team, and promoting a developer to project admin clears their assignment.",
			},
			{
				question: "What happens if I move a synced developer by hand?",
				answer:
					"An explicit assignment to another team is preserved. Unassigning a synced developer only lasts until the next SCIM update.",
			},
			{
				question: "Which identity providers sync groups to teams?",
				answer:
					"Microsoft Entra ID group provisioning maps onto teams. For other identity providers, see [[sso-saml]].",
			},
			{
				question: "What if Enterprise access ends?",
				answer:
					"Existing team policy stays enforced and can still be reviewed. Developers can be unassigned and empty teams deleted, but new teams and policy changes require Enterprise.",
			},
		],
	},
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
		slug: "data-streams",
		title: "Data Streams to Your SIEM",
		subtitle: "Audit and request logs, delivered to your own endpoint",
		tagline: "Your SIEM and warehouse get every event, signed and in order.",
		description:
			"Forward audit logs to your SIEM and export request log metadata to your own HTTPS endpoint in signed, ordered batches, with replay of up to 30 days.",
		longDescription:
			"Security teams want admin activity in the SIEM they already watch, and data teams want request costs in the warehouse they already query. Data Streams deliver both as signed HTTPS requests to an endpoint you run. SIEM forwarding sends every [[audit-logs]] event; log export sends one metadata event per gateway request with model, provider, tokens, cost, latency, and finish reason. Events never include prompts, completions, or tool payloads, and there is no option to add them. Batches of up to 500 events arrive in order, usually within 30 seconds, each signed with HMAC-SHA256. A stream advances its cursor only when your endpoint accepts a batch, so delivery is at least once, and replay re-sends any window of up to 30 days without moving the live cursor.",
		iconName: "radio",
		accent: "rose",
		keywords: [
			"LLM SIEM integration",
			"AI audit log export",
			"LLM log streaming",
			"AI gateway log export",
			"LLM cost data export",
		],
		benefits: [
			{
				title: "Two sources, one mechanism",
				description:
					"SIEM forwarding for audit logs and log export for request metadata, each a stream with its own endpoint.",
			},
			{
				title: "Metadata only, always",
				description:
					"Events carry ids, timestamps, models, tokens, cost, and latency. Prompts, completions, and tool calls are never exported.",
			},
			{
				title: "Signed and verifiable",
				description:
					"Every batch carries an X-LLMGateway-Signature HMAC-SHA256 header, plus an optional bearer token for your endpoint.",
			},
			{
				title: "At-least-once, with replay",
				description:
					"Failed batches retry with backoff from 1 minute to 1 hour, and replay backfills up to 30 days. Deduplicate on the event id.",
			},
		],
		useCases: [
			{
				title: "SIEM correlation",
				description:
					"Line up key rotations, permission changes, and policy edits with the rest of your security telemetry.",
			},
			{
				title: "Chargeback and FinOps",
				description:
					"Land per-request cost and token data in your warehouse and bill usage back to teams.",
			},
			{
				title: "Incident forensics",
				description:
					"Replay a 30-day window into a fresh endpoint when an investigation needs the full trail.",
			},
		],
		howItWorks: [
			{
				step: "01",
				title: "Turn streams on",
				description:
					"Data streams are enabled per organization on request. Request log export is a separate switch.",
			},
			{
				step: "02",
				title: "Add your endpoint",
				description:
					"On the Data Streams page, click New stream and enter your HTTPS endpoint and a signing secret, then send a test event to check the response.",
			},
			{
				step: "03",
				title: "Accept batches",
				description:
					"Respond with any 2xx to accept a batch. If your endpoint keeps failing, the stream pauses, owners and admins are notified, and it resumes from where it stopped.",
			},
		],
		faq: [
			{
				question: "Do streams ever include prompts or completions?",
				answer:
					"No. Events only carry metadata, and there is no option to include payloads.",
			},
			{
				question: "What happens when my endpoint is down?",
				answer:
					"Deliveries retry with backoff from 1 minute up to 1 hour. A stream pauses after 20 failed deliveries in a row, or after 3 deliveries rejected with a 4xx since the last accepted one. Resume it once the endpoint is fixed and delivery continues from where it stopped.",
			},
			{
				question: "Are changes to streams audited?",
				answer:
					"Yes. Every stream change is recorded in [[audit-logs]] as a data_stream.* action.",
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
		slug: "dynamic-routes",
		title: "Dynamic Routes",
		subtitle: "Routing logic that lives in the gateway, not your code",
		tagline: "Change which model serves a request without shipping a deploy.",
		description:
			"Named, versioned routing flows with conditions, classifier branches, A/B splits, and model targets. Call one with dynamic/<name> and roll back instantly.",
		longDescription:
			"Hardcoding a model turns every routing decision into a code change: a different model for paid users, a cheaper one for simple tasks, a 10% canary for a new release. Dynamic Routes move that logic into the gateway. A route is a decision graph of conditions on request headers, body fields, or gateway metadata, classifier branches on difficulty, task, or output type, percentage splits, and model targets, and your application calls it by setting the model to dynamic/<name>. Build it in the visual drag-and-drop editor or as JSON. Edits go to a draft; publishing snapshots an immutable, numbered version, and rolling back re-points the route at any earlier version instantly. Once a route resolves a model, the request goes through the same smart routing as any other: provider scoring, sticky sessions, and cross-provider fallback all still apply. For project-wide defaults, see [[routing-overrides]].",
		iconName: "workflow",
		accent: "violet",
		keywords: [
			"LLM dynamic routing",
			"AI model A/B testing",
			"LLM routing rules",
			"conditional LLM routing",
			"model canary release",
		],
		benefits: [
			{
				title: "Re-route without a deploy",
				description:
					"Swap a model, add a branch, or shift a split in the dashboard. Your application keeps calling the same dynamic/<name>.",
			},
			{
				title: "Conditions and classifiers",
				description:
					"Branch on a header like x-user-tier, a body field like max_tokens, org, project, or key metadata, or a classifier verdict on difficulty, task, or output type.",
			},
			{
				title: "A/B splits and canaries",
				description:
					"Percentage nodes divide traffic between targets, so a new model can take 10% before it takes everything.",
			},
			{
				title: "Versioned, with instant rollback",
				description:
					"Publishing creates an immutable version. Rolling back re-points the route, with no data migration and no redeploy.",
			},
		],
		useCases: [
			{
				title: "Tiered quality",
				description:
					"Send paid users to a frontier model and free users to a fast, cheaper one, keyed on a request header.",
			},
			{
				title: "Cost-aware routing by task",
				description:
					"Let the classifier send simple extraction to a small model and hard analysis to a large one.",
			},
			{
				title: "Safe model migrations",
				description:
					"Canary a new model on a slice of traffic, check the route, version, and node path of each request in the activity log, then publish the full switch.",
			},
		],
		howItWorks: [
			{
				step: "01",
				title: "Build the graph",
				description:
					"Under Project Settings → Dynamic Routes, combine conditional, classifier, percentage, model, and end nodes in the visual editor or as JSON.",
			},
			{
				step: "02",
				title: "Publish a version",
				description:
					"Publishing snapshots the draft as an immutable, numbered version. A route serves traffic only when it is enabled and published.",
			},
			{
				step: "03",
				title: "Call it by name",
				description:
					"Set the model to dynamic/<name>. Each request records the route, version, and node path in its routing metadata.",
			},
		],
		faq: [
			{
				question: "Which endpoints resolve dynamic routes?",
				answer:
					"/v1/chat/completions and the endpoints that proxy through it: /v1/responses, /v1/messages, and the AI SDK gateway endpoints. Embeddings, images, audio, video, rerank, OCR, and moderations do not.",
			},
			{
				question: "How does a route finish?",
				answer:
					"Evaluation starts at the entry node and follows branches until it reaches a model node, which routes the request, or an end node, which rejects it with a 400.",
			},
			{
				question: "Does provider fallback still apply?",
				answer:
					"Yes. Once a route resolves a model, provider scoring, sticky sessions, and automatic cross-provider fallback apply as usual. Published routes are also cached with a stale fallback, so recently used routes keep resolving if the database is briefly unreachable.",
			},
		],
		codeExample: {
			title: "Call a dynamic route",
			language: "bash",
			code: `curl https://api.llmgateway.io/v1/chat/completions \\
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \\
  -H "x-user-tier: paid" \\
  -d '{
    "model": "dynamic/support",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`,
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
		slug: "compliance",
		title: "Provider Compliance Policies",
		subtitle: "Only route to providers you're allowed to use",
		tagline:
			"Block non-compliant providers before any data leaves the gateway.",
		description:
			"Require SOC 2, ISO 27001, GDPR, zero data retention, no prompt training, or approved headquarters countries, and the gateway refuses every provider that falls short.",
		longDescription:
			"Provider Compliance Policies turn a procurement requirement into an enforced guardrail. Pick the certifications and data policies you require, such as SOC 2, ISO 27001, GDPR, [[zero-data-retention]], or no training on prompts, and optionally restrict routing to providers headquartered in the countries you approve. The gateway evaluates every provider against the policy on each request. Non-compliant providers are removed from automatic routing, and a request pinned to one is rejected with a 403 before any prompt is sent upstream. Every requirement is fail-closed: a provider qualifies only if its published data policy explicitly satisfies it, so unknown attributes never slip through. The settings page previews which providers are allowed and blocked, API keys can add stricter policies of their own, and every block is recorded as a security event. Compliance alerts tell you when a provider that meets your policy starts serving a model you are waiting for, or when a provider stops meeting it.",
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
					"Require SOC 2 of any type or Type 2 only, ISO 27001, either of the two, and GDPR. Providers without the certifications you mandate are never used.",
			},
			{
				title: "Data-handling guarantees",
				description:
					"Require providers that do not train on prompts, or enforce zero data retention end to end, on every request rather than in a contract appendix.",
			},
			{
				title: "Headquarters filter",
				description:
					"Route only to providers based in the countries you select. A provider with an unknown headquarters is treated as non-compliant.",
			},
			{
				title: "Fail-closed by default",
				description:
					"A provider qualifies only if its data policy explicitly meets each requirement. Unknown attributes are treated as non-compliant.",
			},
			{
				title: "Compliance alerts",
				description:
					"Watch up to 100 blocked models and get notified in-app, by email, or in Slack when a compliant provider serves one, or when a provider stops meeting your policy.",
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
					"Keep prompts away from providers that train on them, retain them, or operate outside your approved countries.",
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
					"Under Settings → Compliance, turn on the policy, toggle the requirements you need, and pick allowed headquarters countries.",
			},
			{
				step: "02",
				title: "Preview the impact",
				description:
					"The Provider Impact preview shows which providers are allowed and blocked, and why each blocked one fails.",
			},
			{
				step: "03",
				title: "Enforced on every request",
				description:
					"The gateway filters providers per request, blocks anything non-compliant with a 403, and logs a security event.",
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
					"Each provider carries published data-policy metadata: SOC 2, ISO 27001, GDPR, prompt training, prompt logging and retention, and headquarters country. A provider qualifies only if that metadata explicitly satisfies every requirement you enable; unknown attributes fail closed.",
			},
			{
				question: "Can one API key be stricter than the organization?",
				answer:
					"Yes. An API key's Compliance action adds its own requirements, headquarters filter, and provider or model lists. The organization policy stays a mandatory baseline that a key can only tighten.",
			},
			{
				question: "Who can manage the policy?",
				answer:
					"Organization owners and admins on the Enterprise plan. See also [[audit-logs]] and [[guardrails]].",
			},
		],
	},
	{
		slug: "zero-data-retention",
		title: "Zero Data Retention",
		subtitle: "Prompts that are never stored, cached, or kept upstream",
		tagline: "One policy closes every place a prompt could persist.",
		description:
			"Enforce zero data retention across provider routing, gateway storage, response caches, and the Responses API, for the whole organization or a single API key.",
		longDescription:
			"A no-retention promise is easy to make and hard to keep, because a prompt can persist in more places than the provider: request logs, response caches, provider prompt caches, and stored Responses API state. The Zero data retention (ZDR) policy closes all of them at once. Requests route only to providers that do not log prompts and declare a zero-day retention period, and every check fails closed. LLM Gateway keeps metadata only, bypasses its response cache, strips provider prompt-cache markers, and rejects Responses API requests unless they set store: false. Settings that would weaken the policy, such as Retain All Data or project response caching, stay locked until ZDR is turned off. Apply it to the whole organization, or to a single API key when only one workload needs it. ZDR is part of [[compliance]] and composes with every other requirement.",
		iconName: "eye-off",
		accent: "emerald",
		keywords: [
			"zero data retention LLM",
			"ZDR AI gateway",
			"LLM prompt privacy",
			"no prompt logging LLM",
			"enterprise LLM data privacy",
		],
		benefits: [
			{
				title: "Only qualifying providers",
				description:
					"Requests reach only providers that do not log prompts and declare a zero-day retention period. An unknown retention policy never qualifies.",
			},
			{
				title: "Nothing stored at the gateway",
				description:
					"Logs keep metadata such as model, tokens, cost, and latency. Prompts, completions, and tool payloads are never written.",
			},
			{
				title: "Caches closed too",
				description:
					"The gateway response cache is bypassed and provider prompt-cache markers are stripped, so no copy of the prompt is kept for reuse.",
			},
			{
				title: "Hard to weaken by accident",
				description:
					"While ZDR is on, Retain All Data and project response caching cannot be enabled. Turning them back on means disabling ZDR first.",
			},
		],
		useCases: [
			{
				title: "Regulated data",
				description:
					"Healthcare, legal, and financial workloads where a stored prompt would be another copy of customer data to account for.",
			},
			{
				title: "Contractual no-retention clauses",
				description:
					"Back a customer's no-retention requirement with an enforced policy instead of a promise.",
			},
			{
				title: "One sensitive workload",
				description:
					"Set ZDR on a single API key: its requests are metadata-only and uncached, while other keys and organization settings stay as they are.",
			},
		],
		howItWorks: [
			{
				step: "01",
				title: "Clear the prerequisites",
				description:
					"For organization-wide ZDR, set data retention to Metadata Only and turn off response caching in every project.",
			},
			{
				step: "02",
				title: "Enable the policy",
				description:
					"Turn on Zero data retention (ZDR) under Settings → Compliance, or on one API key from its Compliance action.",
			},
			{
				step: "03",
				title: "Enforced on every request",
				description:
					"Non-qualifying providers are skipped, payloads are not stored, caches are bypassed, and a request with no compliant provider is rejected with a 403 before it leaves the gateway.",
			},
		],
		faq: [
			{
				question: "What changes for the Responses API?",
				answer:
					"While ZDR is active, Responses API requests must set store: false, and the gateway does not retain compaction state.",
			},
			{
				question: "Does anything stop working under ZDR?",
				answer:
					"Asynchronous video generation is unavailable, because video jobs need temporary output storage. Response caching and Retain All Data stay unavailable until ZDR is disabled.",
			},
			{
				question: "How is key-level ZDR different?",
				answer:
					"It forces metadata-only logging and bypasses caching only for requests through that key, without changing organization retention or other keys, and it does not require turning off caching in every project first.",
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
		slug: "master-keys",
		title: "Master Keys & Provisioning API",
		subtitle: "Provision projects and keys from your own backend",
		tagline: "Onboard a tenant with an API call, not a dashboard session.",
		description:
			"Org-scoped bearer tokens that create projects, gateway API keys, IAM rules, and custom providers from your backend, and report cost per member and model.",
		longDescription:
			"Multi-tenant platforms and internal developer portals need to create projects and API keys as part of their own onboarding, not by asking someone to click through the dashboard. Master keys are organization-scoped bearer tokens built for that. From your backend, create and update projects, issue gateway API keys with lifetime and recurring spend limits, attach IAM rules to keys and organization members, and register custom providers and models. The same tokens expose usage and cost reporting, so per-member and per-model spend flows into your own dashboards, warehouse, or chargeback process. Master keys are stored as HMAC-SHA256 hashes, shown in plain text only once, scoped to a single organization, and every create, delete, and status change lands in [[audit-logs]].",
		iconName: "key-round",
		accent: "amber",
		keywords: [
			"LLM API key provisioning",
			"multi-tenant LLM API keys",
			"programmatic API key management",
			"LLM gateway admin API",
			"AI chargeback reporting",
		],
		benefits: [
			{
				title: "Provisioning as code",
				description:
					"Create projects, issue gateway API keys, and set IAM rules from the systems that already onboard your tenants.",
			},
			{
				title: "Spend limits on every key",
				description:
					"Give keys a lifetime cap or a recurring hourly, daily, weekly, or monthly window, and read usage back against it.",
			},
			{
				title: "Cost reporting built in",
				description:
					"Pull per-member and per-model usage and cost for chargeback without exporting from the dashboard.",
			},
			{
				title: "Revocable and audited",
				description:
					"Hashed at rest, scoped to one organization, revoked the moment you deactivate them, and recorded in the audit log.",
			},
		],
		useCases: [
			{
				title: "Multi-tenant SaaS",
				description:
					"Create a project and key for every customer at signup, with a spend cap that matches their plan.",
			},
			{
				title: "Internal developer portals",
				description:
					"Let engineers request a key from your own portal, with IAM rules applied automatically.",
			},
			{
				title: "Finance chargeback",
				description:
					"Pull monthly cost per member and model into the systems that bill teams.",
			},
		],
		howItWorks: [
			{
				step: "01",
				title: "Create a master key",
				description:
					"Under Organization → Master Keys, create a key and copy the token. It is shown once.",
			},
			{
				step: "02",
				title: "Call the API",
				description:
					"Send it as Authorization: Bearer llmgmk_... to the /v1/master/* endpoints.",
			},
			{
				step: "03",
				title: "Rotate or revoke",
				description:
					"Deactivate or delete a key to cut off programmatic access immediately.",
			},
		],
		faq: [
			{
				question: "Does programmatic creation bypass limits?",
				answer:
					"No. Project and API-key creation enforces the same per-organization and per-project limits as the dashboard.",
			},
			{
				question: "Can a master key reach another organization?",
				answer:
					"No. Each master key is scoped to a single organization and cannot access resources in any other.",
			},
			{
				question: "How many master keys can an organization have?",
				answer:
					"Up to 10, counting active and inactive keys. Only deleting a key frees a slot.",
			},
		],
		codeExample: {
			title: "List projects with a master key",
			language: "bash",
			code: `curl https://internal.llmgateway.io/v1/master/projects \\
  -H "Authorization: Bearer $MASTER_KEY"`,
		},
	},
	{
		slug: "organization-skills",
		title: "Organization Skills",
		subtitle: "Your team's standards, in every coding agent",
		tagline: "Publish a skill once. Every developer's agent can install it.",
		description:
			"Publish shared agent skills once and let developers install them into Claude Code, Codex, Cursor, OpenCode, and other agents with one CLI command.",
		longDescription:
			"Every team has conventions an agent should follow, from how to review code to which internal libraries to use, and copying them between repositories drifts fast. Organization Skills give them one home. Owners and admins publish skills under Organization → Skills by importing a SKILL.md, importing a folder with references and scripts, or writing one in the dashboard. Developers discover and install them with the LLM Gateway CLI, which writes each skill where their agent looks: Claude Code, Codex, OpenCode, Cursor, and others. Disabling a skill removes it from discovery, and every publish and management action lands in [[audit-logs]] without storing the skill content. Developers can sign in to the CLI through the browser, including your organization's SSO.",
		iconName: "book-open",
		accent: "indigo",
		keywords: [
			"agent skills for teams",
			"Claude Code skills",
			"shared SKILL.md",
			"coding agent instructions",
			"enterprise AI coding standards",
		],
		benefits: [
			{
				title: "One library for every agent",
				description:
					"The CLI installs skills for Claude Code, Codex, OpenCode, Cursor, Qwen, Pi, or the shared .agents directory.",
			},
			{
				title: "Folders, not just prompts",
				description:
					"A skill can bundle references, scripts, and assets: up to 100 supporting files and 1 MB per skill.",
			},
			{
				title: "Access follows the organization",
				description:
					"Downloads use a project API key from an active member, so removed access stops new downloads with a 403.",
			},
			{
				title: "Managed by admins, audited",
				description:
					"Owners and admins publish, edit, disable, and delete. Every action is in the audit log; the content itself is not.",
			},
		],
		useCases: [
			{
				title: "Code review standards",
				description:
					"Publish your review checklist once and have every agent apply it.",
			},
			{
				title: "Internal platform knowledge",
				description:
					"Ship instructions for your internal SDKs and deploy tooling together with the scripts they need.",
			},
			{
				title: "Day-one onboarding",
				description:
					"New developers install the whole library with one command.",
			},
		],
		howItWorks: [
			{
				step: "01",
				title: "Publish",
				description:
					"Under Organization → Skills, import a SKILL.md, import a folder, or write a custom skill. New skills are enabled immediately.",
			},
			{
				step: "02",
				title: "Discover",
				description:
					"Developers run npx @llmgateway/cli skills list to see what the organization publishes.",
			},
			{
				step: "03",
				title: "Install",
				description:
					"skills add <name> --agent claude, or codex, cursor, and others, writes the skill where that agent reads it.",
			},
		],
		faq: [
			{
				question: "What format do skills use?",
				answer:
					"A folder with SKILL.md at its root. Its YAML header needs a unique lowercase, hyphenated name of up to 64 characters and a description of up to 1,024 characters.",
			},
			{
				question: "What happens when a skill is disabled?",
				answer:
					"It disappears from CLI discovery and can no longer be downloaded. Copies already on a developer's machine are not removed.",
			},
			{
				question: "How are downloads authorized?",
				answer:
					"With a project API key issued to an active member who has access to that project. Expired or revoked keys return 401, and missing project or Enterprise access returns 403.",
			},
		],
		codeExample: {
			title: "Install organization skills",
			language: "bash",
			code: `npx @llmgateway/cli skills list
npx @llmgateway/cli skills add code-review --agent claude
npx @llmgateway/cli skills add --all --agent codex`,
		},
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
];

export function getEnterpriseFeatureBySlug(
	slug: string,
): EnterpriseFeatureDefinition | undefined {
	return enterpriseFeatures.find((f) => f.slug === slug);
}
