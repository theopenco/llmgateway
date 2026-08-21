/**
 * Enterprise demo seed.
 *
 * Creates one self-contained enterprise organization with realistic analytics
 * history and — most importantly — pre-built enforcement failure states, so
 * every spend and access limit can be demonstrated live without waiting for
 * spend to accumulate. Thresholds are deliberately tiny (cents, not dollars).
 *
 * Additive and idempotent: it only ever touches rows it owns (ids prefixed
 * `ed-`, plus the organization and its projects), deleting and rewriting them
 * on each run. Nothing else in the local database is affected.
 *
 *   turbo run build --filter=@llmgateway/db
 *   node packages/db/dist/seed-demo.js
 */
/* eslint-disable no-console -- a seed script's output is its user interface */
/* eslint-disable no-mixed-operators -- arithmetic-heavy synthetic data shaping */
import {
	createHmac,
	randomBytes,
	randomInt as cryptoRandomInt,
	scrypt,
} from "crypto";

import { eq, inArray } from "drizzle-orm";

import { closeDatabase, db, tables } from "./index.js";

import type { PgTable } from "drizzle-orm/pg-core";

const ORG_ID = "ed-demo-org";

/**
 * Mirrors `getApiKeyFingerprint` from @llmgateway/shared. Inlined rather than
 * imported because that package's entrypoint pulls in React components, which
 * a plain `node` seed process cannot resolve.
 */
function apiKeyFingerprint(token: string): string {
	const secret =
		(process.env.GATEWAY_API_KEY_HASH_SECRET ?? "").split(",")[0].trim() ||
		"llmgateway-dev-api-key-hash-secret";
	// lgtm[js/insufficient-password-hash]
	return createHmac("sha256", secret).update(token).digest("hex");
}

/**
 * Upsert on the `id` primary key. Rows are written one at a time because the
 * `set` clause has to carry that row's own values — a batched insert can only
 * express one shared `set`, and referencing the table's columns there would
 * assign each column to itself, silently turning a re-run into a no-op.
 */
async function upsertById<T extends Record<string, any>>(
	table: PgTable<any>,
	values: T | T[],
) {
	const rows = Array.isArray(values) ? values : [values];
	for (const row of rows) {
		await db
			.insert(table)
			.values(row)
			.onConflictDoUpdate({ target: (table as any).id, set: row });
	}
}

/**
 * Plain chunked insert, for the aggregate tables that carry a natural-key
 * unique index (project + hour + model). Those rows are deleted wholesale
 * before reseeding, so there is nothing left to conflict with — and an
 * id-targeted upsert would fail against the natural key anyway.
 */
async function insertRows<T extends Record<string, any>>(
	table: PgTable<any>,
	rows: T[],
) {
	for (let i = 0; i < rows.length; i += 500) {
		await db.insert(table).values(rows.slice(i, i + 500));
	}
}

function randomInt(min: number, max: number) {
	return cryptoRandomInt(min, max + 1);
}

function randomFloat(min: number, max: number, decimals = 2) {
	const value = min + (cryptoRandomInt(0, 1_000_000) / 1_000_000) * (max - min);
	return Number(value.toFixed(decimals));
}

function chance(p: number) {
	return cryptoRandomInt(0, 1_000_000) / 1_000_000 < p;
}

function pick<T>(arr: readonly T[]): T {
	return arr[cryptoRandomInt(0, arr.length - 1)];
}

function hoursAgo(hours: number) {
	const d = new Date();
	d.setHours(d.getHours() - hours);
	return d;
}

function daysAgo(days: number) {
	const d = new Date();
	d.setDate(d.getDate() - days);
	return d;
}

// Replicates better-auth's default scrypt hashing so the stored hash verifies
// against the plaintext at login. Kept identical to seed.ts — if better-auth
// changes these parameters, both files must change together.
const SCRYPT_CONFIG = { N: 16384, r: 16, p: 1, dkLen: 64 } as const;

function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16).toString("hex");
	return new Promise((resolve, reject) => {
		scrypt(
			password.normalize("NFKC"),
			salt,
			SCRYPT_CONFIG.dkLen,
			{
				N: SCRYPT_CONFIG.N,
				r: SCRYPT_CONFIG.r,
				p: SCRYPT_CONFIG.p,
				maxmem: 128 * SCRYPT_CONFIG.N * SCRYPT_CONFIG.r * 2,
			},
			(err, key) => {
				if (err) {
					reject(err);
				} else {
					resolve(`${salt}:${key.toString("hex")}`);
				}
			},
		);
	});
}

// ── Catalogue models this org uses, with per-1k prices for cost synthesis ────
// Weighted so the analytics charts have a believable shape: a Bedrock-hosted
// mid tier dominates, a cheap model absorbs high-volume classification.
const MODELS = [
	{
		model: "claude-sonnet-4-5",
		provider: "aws-bedrock",
		inputPrice: 0.003,
		outputPrice: 0.015,
		weight: 30,
	},
	{
		model: "claude-haiku-4-5",
		provider: "aws-bedrock",
		inputPrice: 0.0008,
		outputPrice: 0.004,
		weight: 24,
	},
	{
		model: "claude-opus-4-6",
		provider: "aws-bedrock",
		inputPrice: 0.015,
		outputPrice: 0.075,
		weight: 6,
	},
	{
		model: "llama-4-maverick-17b-instruct",
		provider: "aws-bedrock",
		inputPrice: 0.00024,
		outputPrice: 0.00097,
		weight: 10,
	},
	{
		model: "gpt-4o",
		provider: "openai",
		inputPrice: 0.0025,
		outputPrice: 0.01,
		weight: 12,
	},
	{
		model: "gpt-4o-mini",
		provider: "openai",
		inputPrice: 0.00015,
		outputPrice: 0.0006,
		weight: 10,
	},
	{
		model: "gemini-2.0-flash",
		provider: "google-ai-studio",
		inputPrice: 0.0001,
		outputPrice: 0.0004,
		weight: 8,
	},
] as const;

function pickModel() {
	const total = MODELS.reduce((s, m) => s + m.weight, 0);
	let r = (cryptoRandomInt(0, 1_000_000) / 1_000_000) * total;
	for (const m of MODELS) {
		r -= m.weight;
		if (r <= 0) {
			return m;
		}
	}
	return MODELS[0];
}

const FINISH_REASONS = [
	{ reason: "stop", unified: "completed", weight: 76 },
	{ reason: "tool_calls", unified: "tool_calls", weight: 11 },
	{ reason: "length", unified: "length_limit", weight: 5 },
	{ reason: "error", unified: "upstream_error", weight: 4 },
	{ reason: "content_filter", unified: "content_filter", weight: 2 },
	{ reason: "error", unified: "client_error", weight: 1.5 },
	{ reason: "error", unified: "gateway_error", weight: 0.5 },
] as const;

function pickFinish() {
	const total = FINISH_REASONS.reduce((s, f) => s + f.weight, 0);
	let r = (cryptoRandomInt(0, 1_000_000) / 1_000_000) * total;
	for (const f of FINISH_REASONS) {
		r -= f.weight;
		if (r <= 0) {
			return f;
		}
	}
	return FINISH_REASONS[0];
}

const SOURCES = [
	{ source: "claude.com/claude-code", weight: 0.3 },
	{ source: "cursor", weight: 0.22 },
	{ source: "n8n", weight: 0.14 },
	{ source: "cline", weight: 0.12 },
	{ source: "codex", weight: 0.12 },
	{ source: "opencode", weight: 0.1 },
] as const;

// ── Identities ──────────────────────────────────────────────────────────────
const USERS = [
	{
		id: "ed-user-owner",
		name: "Platform Lead",
		email: "owner@enterprise.demo",
	},
	{
		id: "ed-user-admin",
		name: "Operations Admin",
		email: "admin@enterprise.demo",
	},
	{
		id: "ed-user-dev-ok",
		name: "Alpha Developer",
		email: "dev.alpha@enterprise.demo",
	},
	{
		id: "ed-user-dev-over",
		name: "Beta Developer",
		email: "dev.beta@enterprise.demo",
	},
];

const PROJECTS = [
	{
		id: "ed-proj-support",
		name: "Customer Support Automation",
		mode: "hybrid" as const,
		share: 0.5,
	},
	{
		id: "ed-proj-tooling",
		name: "Internal Developer Tooling",
		mode: "hybrid" as const,
		share: 0.32,
	},
	{
		id: "ed-proj-platform",
		name: "Platform R&D",
		mode: "credits" as const,
		share: 0.18,
	},
];

/**
 * Demo API keys. The `usage` / `currentPeriodUsage` values sit at or just below
 * their limits on purpose — each key is a one-curl demonstration of a specific
 * enforcement path, with no waiting and no real spend required.
 */
const API_KEYS = [
	{
		id: "ed-key-ok",
		token: "demo-ok",
		description: "Support automation — production (healthy)",
		projectId: "ed-proj-support",
		createdBy: "ed-user-dev-ok",
		usageLimit: "25.00",
		usage: "4.13",
		note: "200 — the control case, routes normally",
	},
	{
		id: "ed-key-limit-hit",
		token: "demo-limit-hit",
		description: "Batch translation job (lifetime cap reached)",
		projectId: "ed-proj-support",
		createdBy: "ed-user-dev-ok",
		usageLimit: "0.50",
		usage: "0.50",
		note: "401 — lifetime usage limit",
	},
	{
		id: "ed-key-period-hit",
		token: "demo-period-hit",
		description: "Support bot (daily cap reached)",
		projectId: "ed-proj-tooling",
		createdBy: "ed-user-dev-ok",
		usageLimit: null,
		usage: "3.87",
		periodUsageLimit: "0.25",
		periodUsageDurationValue: 1,
		periodUsageDurationUnit: "day" as const,
		currentPeriodUsage: "0.25",
		currentPeriodStartedAt: hoursAgo(6),
		note: "401 — rolling 1-day period limit",
	},
	{
		id: "ed-key-near-limit",
		token: "demo-near-limit",
		description: "Experimental agent (92% of a $0.05 cap)",
		projectId: "ed-proj-support",
		createdBy: "ed-user-dev-ok",
		usageLimit: "0.05",
		usage: "0.046",
		note: "200 now — trips to 401 after a few real requests",
	},
	{
		id: "ed-key-expired",
		token: "demo-expired",
		description: "Contractor key (expired 3 days ago)",
		projectId: "ed-proj-platform",
		createdBy: "ed-user-admin",
		usageLimit: null,
		usage: "1.22",
		expiresAt: daysAgo(3),
		note: "401 — key TTL expired",
	},
	{
		id: "ed-key-restricted",
		token: "demo-restricted",
		description: "Bedrock-only, single-model key",
		projectId: "ed-proj-tooling",
		createdBy: "ed-user-admin",
		usageLimit: null,
		usage: "0.94",
		note: "403 — key IAM rules (model + provider allowlist)",
	},
	{
		id: "ed-key-over-budget",
		token: "demo-over-budget",
		description: "Owned by a member who is over budget",
		projectId: "ed-proj-tooling",
		createdBy: "ed-user-dev-over",
		usageLimit: null,
		usage: "6.40",
		note: "403 — member budget exceeded ($6.40 of $2.00)",
	},
	{
		id: "ed-key-platform",
		token: "demo-platform",
		description: "Platform R&D — evaluation harness",
		projectId: "ed-proj-platform",
		createdBy: "ed-user-owner",
		usageLimit: "100.00",
		usage: "18.66",
		note: "200 — routes normally",
	},
];

const PROJECT_IDS = PROJECTS.map((p) => p.id);
const API_KEY_IDS = API_KEYS.map((k) => k.id);

/** Remove everything this seed owns, so a re-run is a clean rewrite. */
async function resetOwnedRows() {
	// Child rows first — several of these tables carry no FK back to the org.
	await db
		.delete(tables.apiKeyHourlyModelStats)
		.where(inArray(tables.apiKeyHourlyModelStats.apiKeyId, API_KEY_IDS));
	await db
		.delete(tables.apiKeyHourlyStats)
		.where(inArray(tables.apiKeyHourlyStats.apiKeyId, API_KEY_IDS));
	await db
		.delete(tables.projectHourlyModelStats)
		.where(inArray(tables.projectHourlyModelStats.projectId, PROJECT_IDS));
	await db
		.delete(tables.projectHourlySourceStats)
		.where(inArray(tables.projectHourlySourceStats.projectId, PROJECT_IDS));
	await db
		.delete(tables.projectHourlyStats)
		.where(inArray(tables.projectHourlyStats.projectId, PROJECT_IDS));
	await db.delete(tables.log).where(eq(tables.log.organizationId, ORG_ID));
	await db
		.delete(tables.guardrailViolation)
		.where(eq(tables.guardrailViolation.organizationId, ORG_ID));
	await db
		.delete(tables.auditLog)
		.where(eq(tables.auditLog.organizationId, ORG_ID));
	await db
		.delete(tables.transaction)
		.where(eq(tables.transaction.organizationId, ORG_ID));
}

async function seedDemo() {
	await resetOwnedRows();

	// ── Users ────────────────────────────────────────────────────────────────
	for (const u of USERS) {
		await upsertById(tables.user, {
			id: u.id,
			name: u.name,
			email: u.email,
			emailVerified: true,
			// Without this every login lands on /onboarding instead of the
			// dashboard — which would derail the demo on the very first click.
			onboardingCompleted: true,
		});
		await upsertById(tables.account, {
			id: `${u.id}-account`,
			providerId: "credential",
			accountId: `${u.id}-account`,
			password: await hashPassword(u.email),
			userId: u.id,
		});
	}

	// ── Organization ─────────────────────────────────────────────────────────
	await upsertById(tables.organization, {
		id: ORG_ID,
		name: "Enterprise Demo",
		billingEmail: "owner@enterprise.demo",
		credits: "4218.55",
		plan: "enterprise",
		kind: "default",
		retentionLevel: "retain",
		status: "active",
		planStartedAt: daysAgo(120),
		planExpiresAt: daysAgo(-245),
		autoTopUpEnabled: true,
		autoTopUpThreshold: "500",
		autoTopUpAmount: "2500",
		lastTopUpAmount: "2500",
		// Org-wide default budget applied to every developer member.
		defaultDeveloperMaxApiKeys: 5,
		defaultDeveloperUsageLimit: "25.00",
		defaultDeveloperPeriodUsageLimit: "5.00",
		defaultDeveloperPeriodUsageDurationValue: 1,
		defaultDeveloperPeriodUsageDurationUnit: "day",
		// Fail-closed routing policy. Deliberately NOT enabling
		// `blockPromptLogging`: that rule additionally excludes OpenAI, Anthropic
		// direct and Google AI Studio — the providers with working local env keys
		// — which would leave no provider able to serve a live demo request. As
		// configured, 18 of 49 providers pass, so the org Models page still shows
		// a substantial block list with per-row reasons.
		providerCompliancePolicy: {
			enabled: true,
			requireSoc2OrIso27001: true,
			requireGdpr: true,
			blockApiTraining: true,
			blockStealthProviders: true,
			allowedCountries: ["US", "GB", "DE", "FR", "NL", "IE"],
		},
	});

	// ── Memberships, with per-member budgets ─────────────────────────────────
	const memberships = [
		{
			id: "ed-uo-owner",
			userId: "ed-user-owner",
			role: "owner" as const,
			maxApiKeys: null,
			usageLimit: null,
		},
		{
			id: "ed-uo-admin",
			userId: "ed-user-admin",
			role: "admin" as const,
			maxApiKeys: null,
			usageLimit: null,
		},
		{
			// Within budget: spends against a $25.00 cap.
			id: "ed-uo-dev-ok",
			userId: "ed-user-dev-ok",
			role: "developer" as const,
			maxApiKeys: 5,
			usageLimit: "25.00",
			periodUsageLimit: "5.00",
			periodUsageDurationValue: 1,
			periodUsageDurationUnit: "day" as const,
		},
		{
			// Over budget: owns ed-key-over-budget at $6.40 against a $2.00 cap.
			id: "ed-uo-dev-over",
			userId: "ed-user-dev-over",
			role: "developer" as const,
			maxApiKeys: 3,
			usageLimit: "2.00",
			periodUsageLimit: "1.00",
			periodUsageDurationValue: 1,
			periodUsageDurationUnit: "day" as const,
		},
	];

	for (const m of memberships) {
		await upsertById(tables.userOrganization, {
			...m,
			organizationId: ORG_ID,
		});
	}

	// Give the local admin account access so the org is reachable by simply
	// switching organizations after a normal login.
	const localAdmin = await db.query.user.findFirst({
		where: { email: "admin@example.com" },
	});
	if (localAdmin) {
		await upsertById(tables.userOrganization, {
			id: "ed-uo-local-admin",
			userId: localAdmin.id,
			organizationId: ORG_ID,
			role: "owner",
		});
	}

	// ── Projects ─────────────────────────────────────────────────────────────
	for (const p of PROJECTS) {
		await upsertById(tables.project, {
			id: p.id,
			name: p.name,
			organizationId: ORG_ID,
			mode: p.mode,
			status: "active",
			cachingEnabled: p.id === "ed-proj-tooling",
			cacheDurationSeconds: 120,
		});
	}

	// Project-scoped grants: each developer sees only their own projects.
	await upsertById(tables.userProject, [
		{
			id: "ed-up-dev-ok-support",
			userOrganizationId: "ed-uo-dev-ok",
			projectId: "ed-proj-support",
		},
		{
			id: "ed-up-dev-ok-tooling",
			userOrganizationId: "ed-uo-dev-ok",
			projectId: "ed-proj-tooling",
		},
		{
			id: "ed-up-dev-over-tooling",
			userOrganizationId: "ed-uo-dev-over",
			projectId: "ed-proj-tooling",
		},
	]);

	// ── API keys ─────────────────────────────────────────────────────────────
	for (const k of API_KEYS) {
		const { note: _note, ...row } = k;
		await upsertById(tables.apiKey, {
			...row,
			status: "active",
			keyType: "user",
		});
	}

	// ── IAM rules ────────────────────────────────────────────────────────────
	// Member-level ceiling: this member may only ever reach one provider.
	await upsertById(tables.userIamRule, [
		{
			id: "ed-iam-member-providers",
			userOrganizationId: "ed-uo-dev-over",
			ruleType: "allow_providers",
			ruleValue: { providers: ["aws-bedrock"] },
			status: "active",
		},
	]);

	// Key-level narrowing: one model, one provider.
	await upsertById(tables.apiKeyIamRule, [
		{
			id: "ed-iam-key-models",
			apiKeyId: "ed-key-restricted",
			ruleType: "allow_models",
			ruleValue: { models: ["claude-haiku-4-5"] },
			status: "active",
		},
		{
			id: "ed-iam-key-providers",
			apiKeyId: "ed-key-restricted",
			ruleType: "allow_providers",
			ruleValue: { providers: ["aws-bedrock"] },
			status: "active",
		},
	]);

	// ── Master key (service account for provisioning) ────────────────────────
	const masterToken = "llmgmkdev_enterprise_demo_master_key";
	await upsertById(tables.masterKey, {
		id: "ed-master-key",
		tokenHash: apiKeyFingerprint(masterToken),
		maskedToken: `${masterToken.slice(0, 14)}...${masterToken.slice(-4)}`,
		description: "Team onboarding automation",
		status: "active",
		organizationId: ORG_ID,
		createdBy: "ed-user-owner",
		lastUsedAt: hoursAgo(5),
	});

	// ── Guardrails ───────────────────────────────────────────────────────────
	await upsertById(tables.guardrailConfig, {
		id: "ed-guardrail-config",
		organizationId: ORG_ID,
		enabled: true,
		systemRules: {
			prompt_injection: { enabled: true, action: "block" },
			jailbreak: { enabled: true, action: "block" },
			pii_detection: { enabled: true, action: "redact" },
			secrets: { enabled: true, action: "block" },
			file_types: { enabled: true, action: "block" },
			document_leakage: { enabled: true, action: "warn" },
		},
		maxFileSizeMb: 8,
		allowedFileTypes: ["image/png", "image/jpeg", "image/webp"],
		piiAction: "redact",
	});

	await upsertById(tables.guardrailRule, [
		{
			id: "ed-rule-codenames",
			organizationId: ORG_ID,
			name: "Unreleased project codenames",
			type: "blocked_terms",
			config: {
				type: "blocked_terms",
				terms: ["project-atlas", "release-12.9", "unannounced-product"],
				matchType: "contains",
				caseSensitive: false,
			},
			priority: 10,
			enabled: true,
			action: "block",
		},
		{
			id: "ed-rule-accountids",
			organizationId: ORG_ID,
			name: "Customer account identifiers",
			type: "custom_regex",
			config: { type: "custom_regex", pattern: "\\bACC-\\d{9}\\b" },
			priority: 20,
			enabled: true,
			action: "redact",
		},
	]);

	const violationTemplates = [
		{
			ruleId: "system:prompt_injection",
			ruleName: "Prompt injection",
			category: "prompt_injection",
			actionTaken: "blocked" as const,
			matchedPattern: "ignore (all )?previous instructions",
		},
		{
			ruleId: "system:secrets",
			ruleName: "Secrets detection",
			category: "secrets",
			actionTaken: "blocked" as const,
			matchedPattern: "AKIA[0-9A-Z]{16}",
		},
		{
			ruleId: "system:pii_detection",
			ruleName: "PII detection",
			category: "pii",
			actionTaken: "redacted" as const,
			matchedPattern: "email",
		},
		{
			ruleId: "ed-rule-codenames",
			ruleName: "Unreleased project codenames",
			category: "blocked_terms",
			actionTaken: "blocked" as const,
			matchedPattern: "project-atlas",
		},
		{
			ruleId: "ed-rule-accountids",
			ruleName: "Customer account identifiers",
			category: "custom_regex",
			actionTaken: "redacted" as const,
			matchedPattern: "\\bACC-\\d{9}\\b",
		},
		{
			ruleId: "system:jailbreak",
			ruleName: "Jailbreak detection",
			category: "jailbreak",
			actionTaken: "blocked" as const,
			matchedPattern: "DAN mode",
		},
		{
			ruleId: "system:document_leakage",
			ruleName: "Document leakage",
			category: "document_leakage",
			actionTaken: "warned" as const,
			matchedPattern: "internal design document",
		},
	];

	const violations = [];
	for (let i = 0; i < 42; i++) {
		const t = pick(violationTemplates);
		const m = pickModel();
		violations.push({
			id: `ed-violation-${i}`,
			organizationId: ORG_ID,
			logId: null,
			ruleId: t.ruleId,
			ruleName: t.ruleName,
			category: t.category,
			actionTaken: t.actionTaken,
			matchedPattern: t.matchedPattern,
			matchedContent: "[redacted for display]",
			contentHash: `sha256:${i.toString(16).padStart(8, "0")}`,
			apiKeyId: pick(API_KEYS).id,
			model: m.model,
			createdAt: hoursAgo(randomInt(0, 24 * 21)),
		});
	}
	await insertRows(tables.guardrailViolation, violations);

	// ── Audit log ────────────────────────────────────────────────────────────
	const auditTemplates = [
		{
			action: "team_member.invite",
			resourceType: "team_member",
			resourceId: "ed-user-dev-over",
			userId: "ed-user-admin",
		},
		{
			action: "team_member.role_update",
			resourceType: "team_member",
			resourceId: "ed-user-admin",
			userId: "ed-user-owner",
		},
		{
			action: "team_member.budget_update",
			resourceType: "team_member",
			resourceId: "ed-user-dev-over",
			userId: "ed-user-admin",
		},
		{
			action: "api_key.create",
			resourceType: "api_key",
			resourceId: "ed-key-ok",
			userId: "ed-user-dev-ok",
		},
		{
			action: "api_key.update",
			resourceType: "api_key",
			resourceId: "ed-key-near-limit",
			userId: "ed-user-admin",
		},
		{
			action: "api_key.delete",
			resourceType: "api_key",
			resourceId: "ed-key-expired",
			userId: "ed-user-admin",
		},
		{
			action: "project.create",
			resourceType: "project",
			resourceId: "ed-proj-platform",
			userId: "ed-user-owner",
		},
		{
			action: "payment.auto_topup.update",
			resourceType: "organization",
			resourceId: ORG_ID,
			userId: "ed-user-owner",
		},
		{
			action: "provider_key.create",
			resourceType: "provider_key",
			resourceId: "ed-provider-bedrock",
			userId: "ed-user-owner",
		},
	];

	// Only keep templates whose action/resourceType are valid in this schema
	// version, so the seed survives changes to those enums.
	const validActions = new Set<string>(tables.auditLogActions);
	const validResources = new Set<string>(tables.auditLogResourceTypes);
	const usableTemplates = auditTemplates.filter(
		(t) => validActions.has(t.action) && validResources.has(t.resourceType),
	);

	const auditRows = [];
	for (let i = 0; i < 60 && usableTemplates.length > 0; i++) {
		const t = pick(usableTemplates);
		auditRows.push({
			id: `ed-audit-${i}`,
			organizationId: ORG_ID,
			userId: t.userId,
			action: t.action as any,
			resourceType: t.resourceType as any,
			resourceId: t.resourceId,
			metadata: { source: "dashboard" },
			createdAt: hoursAgo(randomInt(0, 24 * 60)),
		});
	}
	await insertRows(tables.auditLog, auditRows);

	// ── Transactions ─────────────────────────────────────────────────────────
	const txRows = [];
	for (let i = 0; i < 9; i++) {
		txRows.push({
			id: `ed-tx-${i}`,
			organizationId: ORG_ID,
			type: "credit_topup" as const,
			amount: "2500",
			creditAmount: "2500",
			currency: "USD",
			status: "completed" as const,
			description: "Automatic top-up",
			createdAt: daysAgo(randomInt(1, 150)),
		});
	}
	await insertRows(tables.transaction, txRows);

	// ── Activity logs ────────────────────────────────────────────────────────
	const keysByProject = new Map<string, typeof API_KEYS>();
	for (const k of API_KEYS) {
		const list = keysByProject.get(k.projectId) ?? [];
		list.push(k);
		keysByProject.set(k.projectId, list as any);
	}

	const logRows = [];
	let logIdx = 0;
	for (const proj of PROJECTS) {
		const projKeys = keysByProject.get(proj.id) ?? [];
		if (projKeys.length === 0) {
			continue;
		}
		const numLogs = Math.round(600 * proj.share);
		for (let i = 0; i < numLogs; i++) {
			const m = pickModel();
			const finish = pickFinish();
			const isError =
				finish.unified === "upstream_error" ||
				finish.unified === "gateway_error" ||
				finish.unified === "client_error";
			const key = pick(projKeys);
			const createdAt = hoursAgo(randomInt(0, 24 * 30));
			const promptTokens = randomInt(200, 12000);
			const completionTokens = isError ? 0 : randomInt(40, 3000);
			const cachedTokens = chance(0.22) ? randomInt(100, promptTokens) : 0;
			const streamed = chance(0.65);
			const duration = isError ? randomInt(60, 900) : randomInt(400, 18000);
			const inputCost = (promptTokens / 1000) * m.inputPrice;
			const outputCost = (completionTokens / 1000) * m.outputPrice;

			logRows.push({
				id: `ed-log-${logIdx}`,
				requestId: `ed-req-${logIdx}`,
				createdAt,
				updatedAt: createdAt,
				organizationId: ORG_ID,
				projectId: proj.id,
				apiKeyId: key.id,
				duration,
				timeToFirstToken:
					streamed && !isError
						? randomInt(120, Math.min(duration, 2600))
						: null,
				requestedModel: m.model,
				usedModel: m.model,
				usedProvider: m.provider,
				responseSize: isError ? 0 : randomInt(200, 22000),
				content: isError ? null : "Generated response content.",
				finishReason: finish.reason,
				unifiedFinishReason: finish.unified,
				promptTokens: String(promptTokens),
				completionTokens: String(completionTokens),
				totalTokens: String(promptTokens + completionTokens),
				cachedTokens: String(cachedTokens),
				temperature: randomFloat(0, 1, 1),
				maxTokens: pick([512, 1024, 2048, 4096, 8192]),
				messages: JSON.stringify([
					{ role: "user", content: "Summarise this support ticket." },
				]),
				cost: Number((inputCost + outputCost).toFixed(6)),
				inputCost: Number(inputCost.toFixed(6)),
				outputCost: Number(outputCost.toFixed(6)),
				hasError: isError,
				errorDetails: isError
					? {
							statusCode: pick([429, 500, 502, 503]),
							statusText: "Error",
							responseText: "Provider returned an error",
						}
					: undefined,
				mode: proj.mode,
				usedMode:
					proj.mode === "credits"
						? ("credits" as const)
						: pick(["credits", "api-keys"] as const),
				streamed,
				cached: cachedTokens > 0,
				source: pick(SOURCES).source,
			});
			logIdx++;
		}
	}
	await insertRows(tables.log, logRows);

	// ── Hourly aggregates: 90 days of project-level history ──────────────────
	const projectStats = [];
	let psIdx = 0;
	for (const proj of PROJECTS) {
		for (let h = 0; h < 24 * 90; h++) {
			const hourTs = hoursAgo(h);
			hourTs.setMinutes(0, 0, 0);
			// Diurnal shape plus a mild upward trend as adoption grows.
			const hourOfDay = hourTs.getHours();
			const diurnal = 0.45 + 0.55 * Math.sin(((hourOfDay - 4) / 24) * Math.PI);
			const trend = 1 + ((24 * 90 - h) / (24 * 90)) * 0.9;
			const base = Math.max(
				1,
				Math.round(
					140 * proj.share * diurnal * trend * randomFloat(0.75, 1.25),
				),
			);
			const errorCount = Math.floor(base * randomFloat(0.005, 0.05));
			const cacheCount = Math.floor(base * randomFloat(0.05, 0.28));
			const streamedCount = Math.floor(base * randomFloat(0.5, 0.75));
			const inputTokens = base * randomInt(600, 4000);
			const outputTokens = base * randomInt(200, 1600);
			const totalCost = base * randomFloat(0.004, 0.03, 6);
			const creditsReq = Math.floor(base * 0.65);

			projectStats.push({
				id: `ed-phs-${psIdx}`,
				projectId: proj.id,
				hourTimestamp: hourTs,
				requestCount: base,
				errorCount,
				cacheCount,
				streamedCount,
				nonStreamedCount: base - streamedCount,
				completedCount: base - errorCount,
				lengthLimitCount: randomInt(0, 4),
				contentFilterCount: randomInt(0, 2),
				toolCallsCount: Math.floor(base * randomFloat(0.05, 0.18)),
				canceledCount: randomInt(0, 2),
				unknownFinishCount: 0,
				clientErrorCount: Math.floor(errorCount * 0.3),
				gatewayErrorCount: Math.floor(errorCount * 0.1),
				upstreamErrorCount: Math.floor(errorCount * 0.6),
				inputTokens: String(inputTokens),
				outputTokens: String(outputTokens),
				totalTokens: String(inputTokens + outputTokens),
				reasoningTokens: String(
					Math.floor(outputTokens * randomFloat(0, 0.25)),
				),
				cachedTokens: String(Math.floor(inputTokens * randomFloat(0, 0.22))),
				cost: Number(totalCost.toFixed(4)),
				inputCost: Number((totalCost * 0.42).toFixed(4)),
				outputCost: Number((totalCost * 0.48).toFixed(4)),
				requestCost: Number((totalCost * 0.1).toFixed(4)),
				dataStorageCost: Number((totalCost * 0.012).toFixed(5)),
				discountSavings: 0,
				imageInputCost: 0,
				imageOutputCost: 0,
				cachedInputCost: Number((totalCost * randomFloat(0, 0.06)).toFixed(4)),
				creditsRequestCount: creditsReq,
				apiKeysRequestCount: base - creditsReq,
				creditsCost: Number((totalCost * 0.65).toFixed(4)),
				apiKeysCost: Number((totalCost * 0.35).toFixed(4)),
				creditsDataStorageCost: 0,
				apiKeysDataStorageCost: 0,
			});
			psIdx++;
		}
	}
	await insertRows(tables.projectHourlyStats, projectStats);

	// ── Hourly aggregates: per-model, 30 days ────────────────────────────────
	// One row per (project, hour, model) — the tuple is uniquely indexed, so
	// iterate models rather than sampling one at random per hour.
	const modelStats = [];
	let msIdx = 0;
	for (const proj of PROJECTS) {
		for (let h = 0; h < 24 * 30; h++) {
			const hourTs = hoursAgo(h);
			hourTs.setMinutes(0, 0, 0);
			for (const m of MODELS) {
				if (chance(0.35)) {
					continue;
				}
				const reqCount = Math.max(
					1,
					Math.round(m.weight * proj.share * randomFloat(0.3, 1.4)),
				);
				const errCount = chance(0.12) ? randomInt(1, 2) : 0;
				const inputTok = reqCount * randomInt(500, 3500);
				const outputTok = reqCount * randomInt(150, 1400);
				const inCost = (inputTok / 1000) * m.inputPrice;
				const outCost = (outputTok / 1000) * m.outputPrice;
				const costVal = inCost + outCost;
				const creditsReq = Math.floor(reqCount * 0.65);

				modelStats.push({
					id: `ed-phms-${msIdx}`,
					projectId: proj.id,
					hourTimestamp: hourTs,
					usedModel: m.model,
					usedProvider: m.provider,
					requestCount: reqCount,
					errorCount: errCount,
					cacheCount: Math.floor(reqCount * randomFloat(0, 0.25)),
					streamedCount: Math.floor(reqCount * 0.62),
					nonStreamedCount: reqCount - Math.floor(reqCount * 0.62),
					completedCount: reqCount - errCount,
					lengthLimitCount: 0,
					contentFilterCount: 0,
					toolCallsCount: randomInt(0, 3),
					canceledCount: 0,
					unknownFinishCount: 0,
					clientErrorCount: 0,
					gatewayErrorCount: 0,
					upstreamErrorCount: errCount,
					inputTokens: String(inputTok),
					outputTokens: String(outputTok),
					totalTokens: String(inputTok + outputTok),
					reasoningTokens: "0",
					cachedTokens: "0",
					cost: Number(costVal.toFixed(6)),
					inputCost: Number(inCost.toFixed(6)),
					outputCost: Number(outCost.toFixed(6)),
					requestCost: 0,
					dataStorageCost: 0,
					discountSavings: 0,
					imageInputCost: 0,
					imageOutputCost: 0,
					cachedInputCost: 0,
					creditsRequestCount: creditsReq,
					apiKeysRequestCount: reqCount - creditsReq,
					creditsCost: Number((costVal * 0.65).toFixed(6)),
					apiKeysCost: Number((costVal * 0.35).toFixed(6)),
					creditsDataStorageCost: 0,
					apiKeysDataStorageCost: 0,
				});
				msIdx++;
			}
		}
	}
	await insertRows(tables.projectHourlyModelStats, modelStats);

	// ── Hourly aggregates: per-source (Agents view), 14 days ─────────────────
	const sourceStats = [];
	let ssIdx = 0;
	for (const proj of PROJECTS) {
		for (let h = 0; h < 24 * 14; h++) {
			const hourTs = hoursAgo(h);
			hourTs.setMinutes(0, 0, 0);
			for (const s of SOURCES) {
				if (chance(0.4)) {
					continue;
				}
				const reqCount = Math.max(
					1,
					Math.round(40 * s.weight * proj.share * randomFloat(0.4, 1.6)),
				);
				const inputTok = reqCount * randomInt(800, 4500);
				const outputTok = reqCount * randomInt(200, 1500);
				const costVal = reqCount * randomFloat(0.005, 0.04, 6);
				const creditsReq = Math.floor(reqCount * 0.65);

				sourceStats.push({
					id: `ed-phss-${ssIdx}`,
					projectId: proj.id,
					hourTimestamp: hourTs,
					source: s.source,
					requestCount: reqCount,
					errorCount: 0,
					cacheCount: 0,
					streamedCount: Math.floor(reqCount * 0.7),
					nonStreamedCount: reqCount - Math.floor(reqCount * 0.7),
					completedCount: reqCount,
					lengthLimitCount: 0,
					contentFilterCount: 0,
					toolCallsCount: randomInt(0, 5),
					canceledCount: 0,
					unknownFinishCount: 0,
					clientErrorCount: 0,
					gatewayErrorCount: 0,
					upstreamErrorCount: 0,
					inputTokens: String(inputTok),
					outputTokens: String(outputTok),
					totalTokens: String(inputTok + outputTok),
					reasoningTokens: "0",
					cachedTokens: "0",
					cost: Number(costVal.toFixed(6)),
					inputCost: Number((costVal * 0.45).toFixed(6)),
					outputCost: Number((costVal * 0.55).toFixed(6)),
					requestCost: 0,
					dataStorageCost: 0,
					discountSavings: 0,
					imageInputCost: 0,
					imageOutputCost: 0,
					cachedInputCost: 0,
					creditsRequestCount: creditsReq,
					apiKeysRequestCount: reqCount - creditsReq,
					creditsCost: Number((costVal * 0.65).toFixed(6)),
					apiKeysCost: Number((costVal * 0.35).toFixed(6)),
					creditsDataStorageCost: 0,
					apiKeysDataStorageCost: 0,
				});
				ssIdx++;
			}
		}
	}
	await insertRows(tables.projectHourlySourceStats, sourceStats);

	// ── Hourly aggregates: per-API-key (drives member analytics + key stats) ──
	// Recent-hour costs are kept small so each member's rolling period spend
	// stays close to the budgets configured above — the over-budget developer
	// must read as over budget on the Team page, not only at the gateway.
	const keyStats = [];
	const keyModelStats = [];
	let ksIdx = 0;
	let kmsIdx = 0;
	for (const k of API_KEYS) {
		for (let h = 0; h < 24 * 30; h++) {
			if (chance(0.55)) {
				continue;
			}
			const hourTs = hoursAgo(h);
			hourTs.setMinutes(0, 0, 0);
			const reqCount = randomInt(1, 18);
			const errCount = chance(0.1) ? randomInt(1, 2) : 0;
			const inputTok = reqCount * randomInt(500, 3000);
			const outputTok = reqCount * randomInt(150, 1200);
			const costVal = reqCount * randomFloat(0.002, 0.012, 6);
			const creditsReq = Math.floor(reqCount * 0.65);

			keyStats.push({
				id: `ed-akhs-${ksIdx}`,
				apiKeyId: k.id,
				projectId: k.projectId,
				hourTimestamp: hourTs,
				requestCount: reqCount,
				errorCount: errCount,
				cacheCount: randomInt(0, 3),
				streamedCount: Math.floor(reqCount * 0.6),
				nonStreamedCount: reqCount - Math.floor(reqCount * 0.6),
				completedCount: reqCount - errCount,
				lengthLimitCount: 0,
				contentFilterCount: 0,
				toolCallsCount: randomInt(0, 3),
				canceledCount: 0,
				unknownFinishCount: 0,
				clientErrorCount: 0,
				gatewayErrorCount: 0,
				upstreamErrorCount: errCount,
				inputTokens: String(inputTok),
				outputTokens: String(outputTok),
				totalTokens: String(inputTok + outputTok),
				reasoningTokens: "0",
				cachedTokens: "0",
				cacheWriteTokens: "0",
				cost: Number(costVal.toFixed(6)),
				inputCost: Number((costVal * 0.45).toFixed(6)),
				outputCost: Number((costVal * 0.55).toFixed(6)),
				requestCost: 0,
				dataStorageCost: 0,
				discountSavings: 0,
				imageInputCost: 0,
				imageOutputCost: 0,
				audioInputCost: 0,
				audioOutputCost: 0,
				videoOutputCost: 0,
				cachedInputCost: 0,
				cacheWriteInputCost: 0,
				creditsRequestCount: creditsReq,
				apiKeysRequestCount: reqCount - creditsReq,
				creditsCost: Number((costVal * 0.65).toFixed(6)),
				apiKeysCost: Number((costVal * 0.35).toFixed(6)),
				creditsDataStorageCost: 0,
				apiKeysDataStorageCost: 0,
			});
			ksIdx++;

			const m = pickModel();
			const kmInCost = (inputTok / 1000) * m.inputPrice;
			const kmOutCost = (outputTok / 1000) * m.outputPrice;
			keyModelStats.push({
				id: `ed-akhms-${kmsIdx}`,
				apiKeyId: k.id,
				projectId: k.projectId,
				hourTimestamp: hourTs,
				usedModel: m.model,
				usedProvider: m.provider,
				requestCount: reqCount,
				errorCount: errCount,
				cacheCount: 0,
				streamedCount: Math.floor(reqCount * 0.6),
				nonStreamedCount: reqCount - Math.floor(reqCount * 0.6),
				completedCount: reqCount - errCount,
				lengthLimitCount: 0,
				contentFilterCount: 0,
				toolCallsCount: 0,
				canceledCount: 0,
				unknownFinishCount: 0,
				clientErrorCount: 0,
				gatewayErrorCount: 0,
				upstreamErrorCount: errCount,
				inputTokens: String(inputTok),
				outputTokens: String(outputTok),
				totalTokens: String(inputTok + outputTok),
				reasoningTokens: "0",
				cachedTokens: "0",
				cacheWriteTokens: "0",
				cost: Number((kmInCost + kmOutCost).toFixed(6)),
				inputCost: Number(kmInCost.toFixed(6)),
				outputCost: Number(kmOutCost.toFixed(6)),
				requestCost: 0,
				dataStorageCost: 0,
				discountSavings: 0,
				imageInputCost: 0,
				imageOutputCost: 0,
				audioInputCost: 0,
				audioOutputCost: 0,
				videoOutputCost: 0,
				cachedInputCost: 0,
				cacheWriteInputCost: 0,
				creditsRequestCount: creditsReq,
				apiKeysRequestCount: reqCount - creditsReq,
				creditsCost: Number(((kmInCost + kmOutCost) * 0.65).toFixed(6)),
				apiKeysCost: Number(((kmInCost + kmOutCost) * 0.35).toFixed(6)),
				creditsDataStorageCost: 0,
				apiKeysDataStorageCost: 0,
			});
			kmsIdx++;
		}
	}
	await insertRows(tables.apiKeyHourlyStats, keyStats);
	await insertRows(tables.apiKeyHourlyModelStats, keyModelStats);

	// ── Summary ──────────────────────────────────────────────────────────────
	console.log("\n  Enterprise demo organization seeded\n");
	console.log(`  org        ${ORG_ID} — enterprise plan, $4,218.55 credits`);
	console.log(`  projects   ${PROJECTS.length}`);
	console.log(`  members    ${USERS.length} (password == email)`);
	console.log(
		`  rows       ${logRows.length} logs · ${projectStats.length} project-hours · ${modelStats.length} model-hours · ${sourceStats.length} source-hours · ${keyStats.length} key-hours`,
	);
	console.log(`  violations ${violations.length}   audit ${auditRows.length}`);
	console.log("\n  Enforcement demo keys:\n");
	for (const k of API_KEYS) {
		console.log(`    ${k.token.padEnd(18)} ${k.note}`);
	}
	console.log(`\n  Master key: ${masterToken}\n`);
}

seedDemo()
	.then(async () => {
		await closeDatabase();
		process.exit(0);
	})
	.catch(async (e) => {
		console.error(e);
		await closeDatabase();
		process.exit(1);
	});
