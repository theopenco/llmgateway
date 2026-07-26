import {
	randomBytes,
	randomInt as cryptoRandomInt,
	randomUUID,
	scrypt,
} from "crypto";

import { redisClient } from "@llmgateway/cache";
import {
	models as allModels,
	providers as allProviders,
} from "@llmgateway/models";
import { getDevPlanCreditsLimit } from "@llmgateway/shared";

import { closeDatabase, db, tables } from "./index.js";
import { logs } from "./logs.js";

import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";
import type { PgTable } from "drizzle-orm/pg-core";

/**
 * Universal upsert function that handles inserting data with conflict resolution
 * @param table The table to insert into
 * @param values The values to insert (single object or array of objects)
 * @param uniqueKey The column name that serves as the unique identifier (usually 'id')
 * @returns The result of the insert operation
 */
async function upsert<T extends Record<string, any>>(
	table: PgTable<any>,
	values: T,
	uniqueKey = "id",
) {
	return await db
		.insert(table)
		.values(values)
		.onConflictDoUpdate({
			target: table[uniqueKey as keyof typeof table] as any,
			set: values,
		});
}

async function bulkInsert<T extends Record<string, any>>(
	table: PgTable<any>,
	values: T[],
	batchSize = 100,
) {
	for (let i = 0; i < values.length; i += batchSize) {
		const batch = values.slice(i, i + batchSize);
		await db.insert(table).values(batch).onConflictDoNothing();
	}
}

// CSPRNG-backed uniform float in [0, 1). Seed data is not security-sensitive,
// but routing all randomness through a secure source keeps CodeQL's
// js/insecure-randomness query quiet without per-line suppressions.
function secureRandom(): number {
	const scale = 2 ** 47;
	return cryptoRandomInt(0, scale) / scale;
}

function randomInt(min: number, max: number) {
	return Math.floor(secureRandom() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number, decimals = 2) {
	/* eslint-disable no-mixed-operators */
	return Number((secureRandom() * (max - min) + min).toFixed(decimals));
	/* eslint-enable no-mixed-operators */
}

function randomChoice<T>(arr: T[]): T {
	return arr[Math.floor(secureRandom() * arr.length)]!;
}

function daysAgo(days: number) {
	/* eslint-disable no-mixed-operators */
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	/* eslint-enable no-mixed-operators */
}

function hoursAgo(hours: number) {
	/* eslint-disable no-mixed-operators */
	return new Date(Date.now() - hours * 60 * 60 * 1000);
	/* eslint-enable no-mixed-operators */
}

// Every seeded account uses its own email address as its plaintext password
// (e.g. log in as admin@example.com with the password "admin@example.com").
// This replicates better-auth's default scrypt hashing (@better-auth/utils
// v0.4.1, node impl) so the stored hash verifies against that plaintext at
// login. Keep these parameters in sync with better-auth if it ever changes.
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

const MODELS = [
	{
		model: "gpt-4o",
		provider: "openai",
		inputPrice: 0.0025,
		outputPrice: 0.01,
	},
	{
		model: "gpt-4o-mini",
		provider: "openai",
		inputPrice: 0.00015,
		outputPrice: 0.0006,
	},
	{ model: "gpt-4", provider: "openai", inputPrice: 0.03, outputPrice: 0.06 },
	{
		model: "gpt-3.5-turbo",
		provider: "openai",
		inputPrice: 0.0005,
		outputPrice: 0.0015,
	},
	{ model: "o1", provider: "openai", inputPrice: 0.015, outputPrice: 0.06 },
	{
		model: "o3-mini",
		provider: "openai",
		inputPrice: 0.00115,
		outputPrice: 0.0044,
	},
	{
		model: "claude-3.5-sonnet",
		provider: "anthropic",
		inputPrice: 0.003,
		outputPrice: 0.015,
	},
	{
		model: "claude-3-haiku",
		provider: "anthropic",
		inputPrice: 0.00025,
		outputPrice: 0.00125,
	},
	{
		model: "claude-3-opus",
		provider: "anthropic",
		inputPrice: 0.015,
		outputPrice: 0.075,
	},
	{
		model: "gemini-2.0-flash",
		provider: "google-ai-studio",
		inputPrice: 0.0001,
		outputPrice: 0.0004,
	},
	{
		model: "gemini-1.5-pro",
		provider: "google-ai-studio",
		inputPrice: 0.00125,
		outputPrice: 0.005,
	},
	{
		model: "llama-3.3-70b-instruct",
		provider: "inference.net",
		inputPrice: 0.0004,
		outputPrice: 0.0004,
	},
	{
		model: "mistral-large",
		provider: "mistral",
		inputPrice: 0.002,
		outputPrice: 0.006,
	},
	{
		model: "deepseek-chat",
		provider: "deepseek",
		inputPrice: 0.00014,
		outputPrice: 0.00028,
	},
	{
		model: "command-r-plus",
		provider: "cohere",
		inputPrice: 0.0025,
		outputPrice: 0.01,
	},
];

const FINISH_REASONS = [
	{ reason: "stop", unified: "completed", weight: 75 },
	{ reason: "length", unified: "length_limit", weight: 8 },
	{ reason: "content_filter", unified: "content_filter", weight: 2 },
	{ reason: "tool_calls", unified: "tool_calls", weight: 10 },
	{ reason: "error", unified: "upstream_error", weight: 3 },
	{ reason: "error", unified: "gateway_error", weight: 1 },
	{ reason: "error", unified: "client_error", weight: 1 },
];

function weightedRandomChoice<T extends { weight: number }>(arr: T[]): T {
	const total = arr.reduce((sum, item) => sum + item.weight, 0);
	let r = secureRandom() * total;
	for (const item of arr) {
		r -= item.weight;
		if (r <= 0) {
			return item;
		}
	}
	return arr[arr.length - 1]!;
}

// Each of these users can log in with their email as both username AND password
// (password == email). See hashPassword() above.
const EXTRA_USERS = [
	{ id: "user-alice", name: "Alice Chen", email: "alice.chen@techcorp.io" },
	{ id: "user-bob", name: "Bob Martinez", email: "bob@startupinc.com" },
	{ id: "user-carol", name: "Carol Williams", email: "carol.w@dataflow.ai" },
	{ id: "user-dave", name: "Dave Kim", email: "dave.kim@cloudnative.dev" },
	{ id: "user-elena", name: "Elena Popov", email: "elena@mlops.studio" },
	{ id: "user-frank", name: "Frank O'Brien", email: "frank@webagency.co" },
	{ id: "user-grace", name: "Grace Liu", email: "grace.liu@fintech.com" },
	{ id: "user-hiro", name: "Hiro Tanaka", email: "hiro@robotics.jp" },
	{ id: "user-iris", name: "Iris Johansson", email: "iris@healthai.se" },
	{ id: "user-james", name: "James Brown", email: "james@devtools.io" },
	{ id: "user-kate", name: "Kate Murphy", email: "kate.m@ecommerce.co" },
	{ id: "user-leo", name: "Leo Rossi", email: "leo@gamedev.it" },
	{ id: "user-maya", name: "Maya Patel", email: "maya@saasplatform.com" },
	{ id: "user-noah", name: "Noah Schmidt", email: "noah@analytics.de" },
	{ id: "user-olivia", name: "Olivia Santos", email: "olivia@edtech.br" },
	{ id: "user-peter", name: "Peter Nguyen", email: "peter@logistics.vn" },
	{ id: "user-quinn", name: "Quinn Taylor", email: "quinn@security.au" },
	{ id: "user-rachel", name: "Rachel Adams", email: "rachel@mediaai.com" },
];

const EXTRA_ORGS: Array<{
	id: string;
	name: string;
	billingEmail: string;
	plan: "free" | "pro" | "enterprise";
	credits: number;
	devPlan: "none" | "lite" | "pro" | "max";
	status: "active" | "inactive";
	kind: "default" | "chat" | "devpass";
	createdAt: Date;
}> = [
	{
		id: "org-techcorp",
		name: "TechCorp Solutions",
		billingEmail: "billing@techcorp.io",
		plan: "pro",
		credits: 450,
		devPlan: "none",
		status: "active",
		kind: "default",
		createdAt: daysAgo(180),
	},
	{
		id: "org-startup",
		name: "StartupInc",
		billingEmail: "billing@startupinc.com",
		plan: "free",
		credits: 12,
		devPlan: "lite",
		status: "active",
		kind: "default",
		createdAt: daysAgo(90),
	},
	{
		id: "org-dataflow",
		name: "DataFlow AI",
		billingEmail: "finance@dataflow.ai",
		plan: "enterprise",
		credits: 5200,
		devPlan: "none",
		status: "active",
		kind: "default",
		createdAt: daysAgo(365),
	},
	{
		id: "org-cloudnative",
		name: "CloudNative Dev",
		billingEmail: "admin@cloudnative.dev",
		plan: "pro",
		credits: 180,
		devPlan: "pro",
		status: "active",
		kind: "default",
		createdAt: daysAgo(150),
	},
	{
		id: "org-mlops",
		name: "MLOps Studio",
		billingEmail: "billing@mlops.studio",
		plan: "enterprise",
		credits: 3400,
		devPlan: "none",
		status: "active",
		kind: "default",
		createdAt: daysAgo(270),
	},
	{
		id: "org-webagency",
		name: "WebAgency Co",
		billingEmail: "frank@webagency.co",
		plan: "free",
		credits: 0,
		devPlan: "none",
		status: "active",
		kind: "default",
		createdAt: daysAgo(45),
	},
	{
		id: "org-fintech",
		name: "FinTech Global",
		billingEmail: "ops@fintech.com",
		plan: "enterprise",
		credits: 8900,
		devPlan: "max",
		status: "active",
		kind: "default",
		createdAt: daysAgo(400),
	},
	{
		id: "org-robotics",
		name: "RoboTech Labs",
		billingEmail: "hiro@robotics.jp",
		plan: "pro",
		credits: 320,
		devPlan: "pro",
		status: "active",
		kind: "default",
		createdAt: daysAgo(200),
	},
	{
		id: "org-healthai",
		name: "HealthAI Sweden",
		billingEmail: "billing@healthai.se",
		plan: "pro",
		credits: 560,
		devPlan: "none",
		status: "active",
		kind: "default",
		createdAt: daysAgo(120),
	},
	{
		id: "org-devtools",
		name: "DevTools Inc",
		billingEmail: "james@devtools.io",
		plan: "free",
		credits: 3,
		devPlan: "lite",
		status: "active",
		kind: "default",
		createdAt: daysAgo(60),
	},
	{
		id: "org-ecommerce",
		name: "E-Commerce Co",
		billingEmail: "billing@ecommerce.co",
		plan: "pro",
		credits: 210,
		devPlan: "none",
		status: "active",
		kind: "default",
		createdAt: daysAgo(300),
	},
	{
		id: "org-gamedev",
		name: "GameDev Italia",
		billingEmail: "leo@gamedev.it",
		plan: "free",
		credits: 7,
		devPlan: "none",
		status: "inactive",
		kind: "default",
		createdAt: daysAgo(500),
	},
	{
		id: "org-saas",
		name: "SaaS Platform Corp",
		billingEmail: "billing@saasplatform.com",
		plan: "enterprise",
		credits: 12500,
		devPlan: "max",
		status: "active",
		kind: "default",
		createdAt: daysAgo(450),
	},
	{
		id: "org-analytics",
		name: "Analytics GmbH",
		billingEmail: "noah@analytics.de",
		plan: "pro",
		credits: 140,
		devPlan: "pro",
		status: "active",
		kind: "default",
		createdAt: daysAgo(80),
	},
	{
		id: "org-edtech",
		name: "EdTech Brasil",
		billingEmail: "olivia@edtech.br",
		plan: "free",
		credits: 1,
		devPlan: "none",
		status: "active",
		kind: "default",
		createdAt: daysAgo(30),
	},
	{
		id: "org-personal-alice",
		name: "Alice's Workspace",
		billingEmail: "alice.chen@techcorp.io",
		plan: "free",
		credits: 25,
		devPlan: "pro",
		status: "active",
		kind: "devpass",
		createdAt: daysAgo(100),
	},
	{
		id: "org-personal-dave",
		name: "Dave's Lab",
		billingEmail: "dave.kim@cloudnative.dev",
		plan: "free",
		credits: 8,
		devPlan: "lite",
		status: "active",
		kind: "devpass",
		createdAt: daysAgo(70),
	},
	{
		id: "org-personal-maya",
		name: "Maya's Projects",
		billingEmail: "maya@saasplatform.com",
		plan: "free",
		credits: 50,
		devPlan: "max",
		status: "active",
		kind: "devpass",
		createdAt: daysAgo(55),
	},
];

const USER_ORG_MAP: Array<{
	userId: string;
	orgId: string;
	role: "owner" | "admin" | "developer";
}> = [
	{ userId: "user-alice", orgId: "org-techcorp", role: "owner" },
	{ userId: "user-bob", orgId: "org-startup", role: "owner" },
	{ userId: "user-carol", orgId: "org-dataflow", role: "owner" },
	{ userId: "user-dave", orgId: "org-cloudnative", role: "owner" },
	{ userId: "user-elena", orgId: "org-mlops", role: "owner" },
	{ userId: "user-frank", orgId: "org-webagency", role: "owner" },
	{ userId: "user-grace", orgId: "org-fintech", role: "owner" },
	{ userId: "user-hiro", orgId: "org-robotics", role: "owner" },
	{ userId: "user-iris", orgId: "org-healthai", role: "owner" },
	{ userId: "user-james", orgId: "org-devtools", role: "owner" },
	{ userId: "user-kate", orgId: "org-ecommerce", role: "owner" },
	{ userId: "user-leo", orgId: "org-gamedev", role: "owner" },
	{ userId: "user-maya", orgId: "org-saas", role: "owner" },
	{ userId: "user-noah", orgId: "org-analytics", role: "owner" },
	{ userId: "user-olivia", orgId: "org-edtech", role: "owner" },
	{ userId: "user-alice", orgId: "org-personal-alice", role: "owner" },
	{ userId: "user-dave", orgId: "org-personal-dave", role: "owner" },
	{ userId: "user-maya", orgId: "org-personal-maya", role: "owner" },
	// Multi-user orgs
	{ userId: "user-bob", orgId: "org-techcorp", role: "developer" },
	{ userId: "user-carol", orgId: "org-techcorp", role: "admin" },
	{ userId: "user-dave", orgId: "org-dataflow", role: "developer" },
	{ userId: "user-elena", orgId: "org-dataflow", role: "admin" },
	{ userId: "user-frank", orgId: "org-dataflow", role: "developer" },
	{ userId: "user-grace", orgId: "org-saas", role: "admin" },
	{ userId: "user-hiro", orgId: "org-saas", role: "developer" },
	{ userId: "user-iris", orgId: "org-fintech", role: "developer" },
	{ userId: "user-james", orgId: "org-fintech", role: "admin" },
	{ userId: "user-kate", orgId: "org-mlops", role: "developer" },
	{ userId: "user-noah", orgId: "org-mlops", role: "developer" },
	{ userId: "user-peter", orgId: "org-robotics", role: "developer" },
	{ userId: "user-quinn", orgId: "org-healthai", role: "admin" },
	{ userId: "user-rachel", orgId: "org-ecommerce", role: "developer" },
];

const PROJECT_NAMES = [
	"Production API",
	"Staging Environment",
	"Internal Chatbot",
	"Customer Support Bot",
	"Content Generator",
	"Code Assistant",
	"Data Pipeline",
	"Research Sandbox",
	"Mobile App Backend",
	"Analytics Engine",
];

interface ProjectDef {
	id: string;
	name: string;
	orgId: string;
	mode: "api-keys" | "credits" | "hybrid";
}

interface ApiKeyDef {
	id: string;
	token: string;
	projectId: string;
	description: string;
	createdBy: string;
	usage: string;
}

function generateProjects(): ProjectDef[] {
	const projects: ProjectDef[] = [];
	const modes: Array<"api-keys" | "credits" | "hybrid"> = [
		"api-keys",
		"credits",
		"hybrid",
	];
	for (const org of EXTRA_ORGS) {
		const numProjects =
			org.plan === "enterprise"
				? randomInt(3, 5)
				: org.plan === "pro"
					? randomInt(2, 3)
					: 1;
		for (let i = 0; i < numProjects; i++) {
			projects.push({
				id: `proj-${org.id}-${i}`,
				name: `${PROJECT_NAMES[i % PROJECT_NAMES.length]} ${i > 0 ? i + 1 : ""}`.trim(),
				orgId: org.id,
				mode: randomChoice(modes),
			});
		}
	}
	return projects;
}

function generateApiKeys(projects: ProjectDef[]): ApiKeyDef[] {
	const keys: ApiKeyDef[] = [];
	let keyIdx = 0;
	for (const proj of projects) {
		const orgOwner = USER_ORG_MAP.find(
			(m) => m.orgId === proj.orgId && m.role === "owner",
		);
		const createdBy = orgOwner?.userId ?? "user-alice";
		const numKeys = randomInt(1, 3);
		for (let i = 0; i < numKeys; i++) {
			keys.push({
				id: `apikey-${keyIdx}`,
				token: `sk-seed-${keyIdx}-${randomUUID().slice(0, 8)}`,
				projectId: proj.id,
				description:
					i === 0 ? "Primary Key" : i === 1 ? "CI/CD Key" : "Development Key",
				createdBy,
				usage: String(randomFloat(0, 50)),
			});
			keyIdx++;
		}
	}
	return keys;
}

function generateLogs(projects: ProjectDef[], apiKeys: ApiKeyDef[]) {
	const generatedLogs = [];
	const keysByProject = new Map<string, ApiKeyDef[]>();
	for (const key of apiKeys) {
		const existing = keysByProject.get(key.projectId) ?? [];
		existing.push(key);
		keysByProject.set(key.projectId, existing);
	}

	for (const proj of projects) {
		const projKeys = keysByProject.get(proj.id);
		if (!projKeys || projKeys.length === 0) {
			continue;
		}

		const org = EXTRA_ORGS.find((o) => o.id === proj.orgId);
		const isHighVolume = org?.plan === "enterprise";
		const isMedVolume = org?.plan === "pro";
		const numLogs = isHighVolume
			? randomInt(80, 150)
			: isMedVolume
				? randomInt(30, 80)
				: randomInt(5, 20);

		for (let i = 0; i < numLogs; i++) {
			const modelDef = randomChoice(MODELS);
			const finishDef = weightedRandomChoice(FINISH_REASONS);
			const isError =
				finishDef.unified === "upstream_error" ||
				finishDef.unified === "gateway_error" ||
				finishDef.unified === "client_error";
			const apiKey = randomChoice(projKeys);
			const createdAt = daysAgo(randomInt(0, 89));
			const promptTokens = randomInt(10, 5000);
			const completionTokens = isError ? 0 : randomInt(10, 4000);
			const totalTokens = promptTokens + completionTokens;
			const cachedTokens =
				secureRandom() < 0.15 ? randomInt(5, promptTokens) : 0;
			const isCached = cachedTokens > 0;
			const isStreamed = secureRandom() < 0.6;
			const duration = isError ? randomInt(50, 500) : randomInt(200, 15000);
			const timeToFirstToken =
				isStreamed && !isError ? randomInt(50, Math.min(duration, 2000)) : null;
			const inputCost = (promptTokens / 1000) * modelDef.inputPrice;
			const outputCost = (completionTokens / 1000) * modelDef.outputPrice;
			const cost = inputCost + outputCost;
			const discount = secureRandom() < 0.1 ? randomFloat(0.05, 0.3) : 0;
			const usedMode =
				proj.mode === "hybrid"
					? randomChoice(["api-keys", "credits"] as const)
					: proj.mode === "api-keys"
						? ("api-keys" as const)
						: ("credits" as const);

			generatedLogs.push({
				id: `seed-log-${proj.id}-${i}`,
				requestId: `req-${proj.id}-${i}`,
				createdAt,
				updatedAt: createdAt,
				organizationId: proj.orgId,
				projectId: proj.id,
				apiKeyId: apiKey.id,
				duration,
				timeToFirstToken,
				requestedModel: modelDef.model,
				usedModel: modelDef.model,
				usedProvider: modelDef.provider,
				responseSize: isError ? 0 : randomInt(100, 15000),
				content: isError ? null : "Generated response content.",
				finishReason: finishDef.reason,
				unifiedFinishReason: finishDef.unified,
				promptTokens: String(promptTokens),
				completionTokens: String(completionTokens),
				totalTokens: String(totalTokens),
				cachedTokens: String(cachedTokens),
				temperature: randomFloat(0, 1, 1),
				maxTokens: randomChoice([256, 512, 1024, 2048, 4096]),
				messages: JSON.stringify([{ role: "user", content: "Seed message" }]),
				cost: Number(cost.toFixed(6)),
				inputCost: Number(inputCost.toFixed(6)),
				outputCost: Number(outputCost.toFixed(6)),
				hasError: isError,
				errorDetails: isError
					? {
							statusCode: randomChoice([400, 429, 500, 502, 503]),
							statusText: "Error",
							responseText: "Provider returned an error",
						}
					: undefined,
				mode: proj.mode,
				usedMode,
				streamed: isStreamed,
				cached: isCached,
				discount,
			});
		}
	}
	return generatedLogs;
}

const TRANSACTION_TYPES = [
	"credit_topup",
	"subscription_start",
	"subscription_cancel",
	"credit_refund",
	"dev_plan_start",
	"dev_plan_upgrade",
	"dev_plan_renewal",
] as const;

function generateTransactions() {
	const transactions = [];
	let txIdx = 0;
	for (const org of EXTRA_ORGS) {
		const numTx =
			org.plan === "enterprise"
				? randomInt(8, 15)
				: org.plan === "pro"
					? randomInt(4, 8)
					: randomInt(1, 3);
		for (let i = 0; i < numTx; i++) {
			const type = randomChoice([...TRANSACTION_TYPES]);
			const isCredit = type === "credit_topup";
			const isRefund = type === "credit_refund";
			const isSub =
				type === "subscription_start" || type === "subscription_cancel";
			const isDevPlan = type.startsWith("dev_plan");
			const amount = isCredit
				? String(randomChoice([10, 25, 50, 100, 200, 500, 1000]))
				: isRefund
					? String(randomChoice([5, 10, 25, 50]))
					: isSub
						? String(randomChoice([29, 99, 299]))
						: isDevPlan
							? String(randomChoice([9, 19, 49]))
							: "0";
			const creditAmount = isCredit || isRefund ? amount : undefined;
			const status =
				secureRandom() < 0.85
					? "completed"
					: secureRandom() < 0.5
						? "pending"
						: "failed";
			transactions.push({
				id: `tx-${txIdx}`,
				organizationId: org.id,
				createdAt: daysAgo(randomInt(0, 180)),
				type,
				amount,
				creditAmount,
				currency: "USD",
				status,
				description: `${type.replace(/_/g, " ")} - ${org.name}`,
			});
			txIdx++;
		}
	}
	return transactions;
}

function generateDiscounts() {
	return [
		{
			id: "disc-global-openai",
			provider: "openai",
			model: null,
			organizationId: null,
			discountPercent: "0.10",
			reason: "Volume partnership discount",
		},
		{
			id: "disc-global-anthropic",
			provider: "anthropic",
			model: null,
			organizationId: null,
			discountPercent: "0.05",
			reason: "Early adopter discount",
		},
		{
			id: "disc-global-deepseek",
			provider: "deepseek",
			model: null,
			organizationId: null,
			discountPercent: "0.15",
			reason: "Promotional pricing",
		},
		{
			id: "disc-org-fintech-all",
			provider: null,
			model: null,
			organizationId: "org-fintech",
			discountPercent: "0.20",
			reason: "Enterprise volume agreement",
		},
		{
			id: "disc-org-saas-openai",
			provider: "openai",
			model: null,
			organizationId: "org-saas",
			discountPercent: "0.25",
			reason: "Strategic partnership",
		},
		{
			id: "disc-org-dataflow-claude",
			provider: "anthropic",
			model: "claude-3.5-sonnet",
			organizationId: "org-dataflow",
			discountPercent: "0.15",
			reason: "Preferred model discount",
		},
		{
			id: "disc-org-mlops-gemini",
			provider: "google-ai-studio",
			model: null,
			organizationId: "org-mlops",
			discountPercent: "0.10",
			reason: "Research collaboration",
		},
	];
}

function generateAuditLogs() {
	const auditLogs = [];
	const actions = [
		{ action: "project.create" as const, resourceType: "project" as const },
		{ action: "api_key.create" as const, resourceType: "api_key" as const },
		{
			action: "api_key.update_status" as const,
			resourceType: "api_key" as const,
		},
		{
			action: "team_member.add" as const,
			resourceType: "team_member" as const,
		},
		{
			action: "provider_key.create" as const,
			resourceType: "provider_key" as const,
		},
		{
			action: "subscription.create" as const,
			resourceType: "subscription" as const,
		},
		{
			action: "payment.credit_topup" as const,
			resourceType: "payment" as const,
		},
		{
			action: "organization.update" as const,
			resourceType: "organization" as const,
		},
	];

	let auditIdx = 0;
	for (const org of EXTRA_ORGS) {
		const orgUsers = USER_ORG_MAP.filter((m) => m.orgId === org.id);
		if (orgUsers.length === 0) {
			continue;
		}
		const numAudits =
			org.plan === "enterprise"
				? randomInt(15, 30)
				: org.plan === "pro"
					? randomInt(5, 15)
					: randomInt(1, 5);
		for (let i = 0; i < numAudits; i++) {
			const actionDef = randomChoice(actions);
			const userMapping = randomChoice(orgUsers);
			auditLogs.push({
				id: `audit-${auditIdx}`,
				organizationId: org.id,
				userId: userMapping.userId,
				createdAt: daysAgo(randomInt(0, 90)),
				action: actionDef.action,
				resourceType: actionDef.resourceType,
				resourceId: `resource-${auditIdx}`,
				metadata: {
					ipAddress: `192.168.${randomInt(1, 254)}.${randomInt(1, 254)}`,
				},
			});
			auditIdx++;
		}
	}
	return auditLogs;
}

function generateProjectHourlyStats(projects: ProjectDef[]) {
	const stats = [];
	let statIdx = 0;
	for (const proj of projects) {
		const org = EXTRA_ORGS.find((o) => o.id === proj.orgId);
		const isHighVolume = org?.plan === "enterprise";
		const isMedVolume = org?.plan === "pro";
		const numHours = isHighVolume ? 720 : isMedVolume ? 360 : 72;
		for (let h = 0; h < numHours; h++) {
			const hourTs = hoursAgo(h);
			hourTs.setMinutes(0, 0, 0);
			const baseRequests = isHighVolume
				? randomInt(20, 200)
				: isMedVolume
					? randomInt(5, 50)
					: randomInt(1, 10);
			const errorCount = Math.floor(baseRequests * randomFloat(0, 0.08));
			const cacheCount = Math.floor(baseRequests * randomFloat(0, 0.2));
			const streamedCount = Math.floor(baseRequests * randomFloat(0.4, 0.7));
			const inputTokens = baseRequests * randomInt(100, 2000);
			const outputTokens = baseRequests * randomInt(50, 1500);
			const costPerReq = randomFloat(0.001, 0.05);
			const totalCost = baseRequests * costPerReq;
			const creditsReqCount = Math.floor(baseRequests * 0.6);
			const apiKeysReqCount = baseRequests - creditsReqCount;

			stats.push({
				id: `phs-${statIdx}`,
				projectId: proj.id,
				hourTimestamp: hourTs,
				requestCount: baseRequests,
				errorCount,
				cacheCount,
				streamedCount,
				nonStreamedCount: baseRequests - streamedCount,
				completedCount: baseRequests - errorCount,
				lengthLimitCount: randomInt(0, 3),
				contentFilterCount: randomInt(0, 1),
				toolCallsCount: randomInt(0, Math.floor(baseRequests * 0.1)),
				canceledCount: randomInt(0, 2),
				unknownFinishCount: 0,
				clientErrorCount: Math.floor(errorCount * 0.3),
				gatewayErrorCount: Math.floor(errorCount * 0.1),
				upstreamErrorCount: Math.floor(errorCount * 0.6),
				inputTokens: String(inputTokens),
				outputTokens: String(outputTokens),
				totalTokens: String(inputTokens + outputTokens),
				reasoningTokens: String(randomInt(0, Math.floor(outputTokens * 0.3))),
				cachedTokens: String(randomInt(0, Math.floor(inputTokens * 0.2))),
				cost: Number(totalCost.toFixed(4)),
				inputCost: Number((totalCost * 0.4).toFixed(4)),
				outputCost: Number((totalCost * 0.5).toFixed(4)),
				requestCost: Number((totalCost * 0.1).toFixed(4)),
				dataStorageCost: 0,
				discountSavings: Number((totalCost * randomFloat(0, 0.05)).toFixed(4)),
				imageInputCost: 0,
				imageOutputCost: 0,
				cachedInputCost: Number((totalCost * randomFloat(0, 0.05)).toFixed(4)),
				creditsRequestCount: creditsReqCount,
				apiKeysRequestCount: apiKeysReqCount,
				creditsCost: Number((totalCost * 0.6).toFixed(4)),
				apiKeysCost: Number((totalCost * 0.4).toFixed(4)),
				creditsDataStorageCost: 0,
				apiKeysDataStorageCost: 0,
			});
			statIdx++;
		}
	}
	return stats;
}

function generateProjectHourlyModelStats(projects: ProjectDef[]) {
	const stats = [];
	let statIdx = 0;
	for (const proj of projects) {
		const org = EXTRA_ORGS.find((o) => o.id === proj.orgId);
		const isHighVolume = org?.plan === "enterprise";
		const isMedVolume = org?.plan === "pro";
		const numHours = isHighVolume ? 168 : isMedVolume ? 72 : 24;
		const modelsUsed = isHighVolume
			? MODELS.slice(0, 8)
			: isMedVolume
				? MODELS.slice(0, 5)
				: MODELS.slice(0, 3);

		for (let h = 0; h < numHours; h++) {
			const hourTs = hoursAgo(h);
			hourTs.setMinutes(0, 0, 0);
			for (const modelDef of modelsUsed) {
				if (secureRandom() < 0.3) {
					continue;
				}
				const reqCount = randomInt(1, isHighVolume ? 30 : 10);
				const errCount = secureRandom() < 0.1 ? randomInt(1, 3) : 0;
				const inputTok = reqCount * randomInt(100, 1500);
				const outputTok = reqCount * randomInt(50, 1000);
				/* eslint-disable no-mixed-operators */
				const costVal =
					(inputTok / 1000) * modelDef.inputPrice +
					(outputTok / 1000) * modelDef.outputPrice;
				/* eslint-enable no-mixed-operators */

				stats.push({
					id: `phms-${statIdx}`,
					projectId: proj.id,
					hourTimestamp: hourTs,
					usedModel: modelDef.model,
					usedProvider: modelDef.provider,
					requestCount: reqCount,
					errorCount: errCount,
					cacheCount: randomInt(0, Math.floor(reqCount * 0.2)),
					streamedCount: Math.floor(reqCount * 0.6),
					nonStreamedCount: Math.floor(reqCount * 0.4),
					completedCount: reqCount - errCount,
					lengthLimitCount: 0,
					contentFilterCount: 0,
					toolCallsCount: randomInt(0, 2),
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
					inputCost: Number(
						((inputTok / 1000) * modelDef.inputPrice).toFixed(6),
					),
					outputCost: Number(
						((outputTok / 1000) * modelDef.outputPrice).toFixed(6),
					),
					requestCost: 0,
					dataStorageCost: 0,
					discountSavings: 0,
					imageInputCost: 0,
					imageOutputCost: 0,
					cachedInputCost: 0,
					creditsRequestCount: Math.floor(reqCount * 0.6),
					apiKeysRequestCount: Math.floor(reqCount * 0.4),
					creditsCost: Number((costVal * 0.6).toFixed(6)),
					apiKeysCost: Number((costVal * 0.4).toFixed(6)),
					creditsDataStorageCost: 0,
					apiKeysDataStorageCost: 0,
				});
				statIdx++;
			}
		}
	}
	return stats;
}

// Coding-agent sources recognized by the Agents dashboard, with relative weights.
const AGENT_SOURCES: Array<{ source: string; weight: number }> = [
	{ source: "claude.com/claude-code", weight: 0.35 },
	{ source: "cursor", weight: 0.2 },
	{ source: "cline", weight: 0.15 },
	{ source: "codex", weight: 0.1 },
	{ source: "opencode", weight: 0.1 },
	{ source: "empryo", weight: 0.08 },
	{ source: "autohand", weight: 0.06 },
	{ source: "n8n", weight: 0.04 },
];

function generateProjectHourlySourceStats(projects: ProjectDef[]) {
	const stats = [];
	let statIdx = 0;
	for (const proj of projects) {
		const org = EXTRA_ORGS.find((o) => o.id === proj.orgId);
		const isHighVolume = org?.plan === "enterprise";
		const isMedVolume = org?.plan === "pro";
		const numHours = isHighVolume ? 168 : isMedVolume ? 72 : 24;
		const sourcesUsed = isHighVolume
			? AGENT_SOURCES.slice(0, 7)
			: isMedVolume
				? AGENT_SOURCES.slice(0, 5)
				: AGENT_SOURCES.slice(0, 3);

		for (let h = 0; h < numHours; h++) {
			const hourTs = hoursAgo(h);
			hourTs.setMinutes(0, 0, 0);
			for (const sourceDef of sourcesUsed) {
				if (secureRandom() < 0.35) {
					continue;
				}
				const reqCount = randomInt(1, isHighVolume ? 25 : 8);
				const errCount = secureRandom() < 0.1 ? randomInt(1, 3) : 0;
				const inputTok = reqCount * randomInt(200, 4000);
				const outputTok = reqCount * randomInt(100, 2500);
				const costPerReq = randomFloat(0.002, 0.06);
				const costVal = reqCount * costPerReq;

				stats.push({
					id: `phss-${statIdx}`,
					projectId: proj.id,
					hourTimestamp: hourTs,
					source: sourceDef.source,
					requestCount: reqCount,
					errorCount: errCount,
					cacheCount: randomInt(0, Math.floor(reqCount * 0.2)),
					streamedCount: Math.floor(reqCount * 0.6),
					nonStreamedCount: Math.floor(reqCount * 0.4),
					completedCount: reqCount - errCount,
					lengthLimitCount: 0,
					contentFilterCount: 0,
					toolCallsCount: randomInt(0, 2),
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
					inputCost: Number((costVal * 0.4).toFixed(6)),
					outputCost: Number((costVal * 0.5).toFixed(6)),
					requestCost: Number((costVal * 0.1).toFixed(6)),
					dataStorageCost: 0,
					discountSavings: 0,
					imageInputCost: 0,
					imageOutputCost: 0,
					audioInputCost: 0,
					videoOutputCost: 0,
					cachedInputCost: 0,
					cacheWriteInputCost: 0,
					creditsRequestCount: Math.floor(reqCount * 0.6),
					apiKeysRequestCount: Math.floor(reqCount * 0.4),
					creditsCost: Number((costVal * 0.6).toFixed(6)),
					apiKeysCost: Number((costVal * 0.4).toFixed(6)),
					creditsDataStorageCost: 0,
					apiKeysDataStorageCost: 0,
				});
				statIdx++;
			}
		}
	}
	return stats;
}

function minutesAgo(minutes: number) {
	/* eslint-disable no-mixed-operators */
	return new Date(Date.now() - minutes * 60 * 1000);
	/* eslint-enable no-mixed-operators */
}

function generateSeedProviders() {
	return allProviders.map((p) => ({
		id: p.id,
		name: p.name,
		description: p.description ?? "",
		streaming: p.streaming ?? null,
		cancellation: p.cancellation ?? null,
		color: p.color ?? null,
		website: p.website ?? null,
		status: "active" as const,
		logsCount: randomInt(500, 50000),
		errorsCount: randomInt(10, 2000),
		clientErrorsCount: randomInt(5, 500),
		gatewayErrorsCount: randomInt(0, 100),
		upstreamErrorsCount: randomInt(5, 1400),
		cachedCount: randomInt(50, 5000),
		avgTimeToFirstToken: randomFloat(80, 2500, 1),
		avgTimeToFirstReasoningToken:
			secureRandom() < 0.3 ? randomFloat(200, 5000, 1) : null,
		statsUpdatedAt: hoursAgo(randomInt(0, 6)),
	}));
}

function generateSeedModels() {
	return (allModels as readonly ModelDefinition[]).map((m) => ({
		id: m.id,
		name: m.name ?? m.id,
		aliases: m.aliases ?? [],
		description: m.description ?? "",
		family: m.family,
		free: m.free ?? false,
		output: m.output ?? ["text"],
		imageInputRequired: m.imageInputRequired ?? false,
		stability: m.stability ?? ("stable" as const),
		releasedAt: m.releasedAt ?? new Date(),
		status: "active" as const,
		logsCount: randomInt(100, 30000),
		errorsCount: randomInt(5, 1500),
		clientErrorsCount: randomInt(2, 300),
		gatewayErrorsCount: randomInt(0, 50),
		upstreamErrorsCount: randomInt(3, 1150),
		cachedCount: randomInt(20, 3000),
		avgTimeToFirstToken: randomFloat(80, 3000, 1),
		avgTimeToFirstReasoningToken:
			secureRandom() < 0.2 ? randomFloat(200, 6000, 1) : null,
		statsUpdatedAt: hoursAgo(randomInt(0, 6)),
	}));
}

function generateSeedModelProviderMappings() {
	const mappings: Array<Record<string, any>> = [];
	for (const m of allModels as readonly ModelDefinition[]) {
		for (const p of m.providers as ProviderModelMapping[]) {
			mappings.push({
				id: `${m.id}::${p.providerId}`,
				modelId: m.id,
				providerId: p.providerId,
				externalId: p.externalId,
				inputPrice:
					p.inputPrice !== undefined && p.inputPrice !== null
						? String(p.inputPrice)
						: null,
				outputPrice:
					p.outputPrice !== undefined && p.outputPrice !== null
						? String(p.outputPrice)
						: null,
				cachedInputPrice:
					p.cachedInputPrice !== undefined && p.cachedInputPrice !== null
						? String(p.cachedInputPrice)
						: null,
				cacheWriteInputPrice:
					p.cacheWriteInputPrice !== undefined &&
					p.cacheWriteInputPrice !== null
						? String(p.cacheWriteInputPrice)
						: null,
				cacheWriteInputPrice1h:
					p.cacheWriteInputPrice1h !== undefined &&
					p.cacheWriteInputPrice1h !== null
						? String(p.cacheWriteInputPrice1h)
						: null,
				imageInputPrice:
					p.imageInputPrice !== undefined && p.imageInputPrice !== null
						? String(p.imageInputPrice)
						: null,
				requestPrice:
					p.requestPrice !== undefined && p.requestPrice !== null
						? String(p.requestPrice)
						: null,
				contextSize: p.contextSize ?? null,
				maxOutput: p.maxOutput ?? null,
				streaming: p.streaming,
				vision: p.vision ?? null,
				reasoning: p.reasoning ?? null,
				reasoningMaxTokens: p.reasoningMaxTokens ?? false,
				tools: p.tools ?? null,
				jsonOutput: p.jsonOutput ?? false,
				jsonOutputSchema: p.jsonOutputSchema ?? false,
				webSearch: p.webSearch ?? false,
				webSearchPrice:
					p.webSearchPrice !== undefined && p.webSearchPrice !== null
						? String(p.webSearchPrice)
						: null,
				stability: p.stability ?? "stable",
				supportedParameters: p.supportedParameters ?? null,
				test: p.test ?? null,
				status: "active" as const,
				logsCount: randomInt(50, 15000),
				errorsCount: randomInt(2, 800),
				clientErrorsCount: randomInt(1, 200),
				gatewayErrorsCount: randomInt(0, 30),
				upstreamErrorsCount: randomInt(1, 570),
				cachedCount: randomInt(10, 2000),
				avgTimeToFirstToken: randomFloat(80, 3000, 1),
				avgTimeToFirstReasoningToken: p.reasoning
					? randomFloat(200, 5000, 1)
					: null,
				statsUpdatedAt: hoursAgo(randomInt(0, 6)),
			});
		}
	}
	return mappings;
}

function generateSeedModelProviderMappingHistory(
	mappings: Array<Record<string, any>>,
) {
	const history: Array<Record<string, any>> = [];
	// Pick one mapping per provider to ensure all providers have history data
	const seenProviders = new Set<string>();
	const topMappings: Array<Record<string, any>> = [];
	for (const m of mappings) {
		if (!seenProviders.has(m.providerId)) {
			seenProviders.add(m.providerId);
			topMappings.push(m);
		}
		if (topMappings.length >= 50) {
			break;
		}
	}
	for (const mapping of topMappings) {
		for (let i = 0; i < 144; i++) {
			const ts = minutesAgo(i * 10);
			ts.setSeconds(0, 0);
			const logs = randomInt(5, 200);
			const errors = randomInt(0, Math.max(1, Math.floor(logs * 0.05)));
			history.push({
				id: `mpmh-${mapping.id}-${i}`,
				modelId: mapping.modelId,
				providerId: mapping.providerId,
				modelProviderMappingId: mapping.id,
				minuteTimestamp: ts,
				logsCount: logs,
				errorsCount: errors,
				clientErrorsCount: Math.floor(errors * 0.3),
				gatewayErrorsCount: Math.floor(errors * 0.1),
				upstreamErrorsCount: Math.floor(errors * 0.6),
				cachedCount: randomInt(0, Math.floor(logs * 0.15)),
				totalInputTokens: logs * randomInt(100, 1500),
				totalOutputTokens: logs * randomInt(50, 1000),
				totalTokens: logs * randomInt(150, 2500),
				totalReasoningTokens: 0,
				totalCachedTokens: randomInt(0, logs * 50),
				totalDuration: logs * randomInt(200, 5000),
				totalTimeToFirstToken: logs * randomInt(50, 500),
				totalTimeToFirstReasoningToken: 0,
			});
		}
	}
	return history;
}

function generateSeedModelHistory() {
	const history: Array<Record<string, any>> = [];
	const topModels = (allModels as readonly ModelDefinition[]).slice(0, 50);
	for (const m of topModels) {
		for (let i = 0; i < 144; i++) {
			const ts = minutesAgo(i * 10);
			ts.setSeconds(0, 0);
			const logCount = randomInt(10, 300);
			const errors = randomInt(0, Math.max(1, Math.floor(logCount * 0.05)));
			history.push({
				id: `mh-${m.id}-${i}`,
				modelId: m.id,
				minuteTimestamp: ts,
				logsCount: logCount,
				errorsCount: errors,
				clientErrorsCount: Math.floor(errors * 0.3),
				gatewayErrorsCount: Math.floor(errors * 0.1),
				upstreamErrorsCount: Math.floor(errors * 0.6),
				cachedCount: randomInt(0, Math.floor(logCount * 0.15)),
				totalInputTokens: logCount * randomInt(100, 1500),
				totalOutputTokens: logCount * randomInt(50, 1000),
				totalTokens: logCount * randomInt(150, 2500),
				totalReasoningTokens: 0,
				totalCachedTokens: randomInt(0, logCount * 50),
				totalDuration: logCount * randomInt(200, 5000),
				totalTimeToFirstToken: logCount * randomInt(50, 500),
				totalTimeToFirstReasoningToken: 0,
			});
		}
	}
	return history;
}

async function seed() {
	// ── Original test data (preserved for tests) ──
	await upsert(tables.installation, {
		id: "self-hosted-installation",
		uuid: randomUUID(),
		type: "self-host",
	});

	await upsert(tables.user, {
		id: "test-user-id",
		name: "Test User",
		// Login: admin@example.com / admin@example.com (password == email)
		email: "admin@example.com",
		emailVerified: true,
	});

	await upsert(tables.account, {
		id: "test-account-id",
		providerId: "credential",
		accountId: "test-account-id",
		password: await hashPassword("admin@example.com"),
		userId: "test-user-id",
	});

	await upsert(tables.organization, {
		id: "test-org-id",
		name: "Test Organization",
		billingEmail: "admin@example.com",
		credits: 5,
		retentionLevel: "retain",
	});

	await upsert(tables.userOrganization, {
		id: "test-user-org-id",
		userId: "test-user-id",
		organizationId: "test-org-id",
	});

	await upsert(tables.project, {
		id: "test-project-id",
		name: "Test Project",
		organizationId: "test-org-id",
		mode: "hybrid",
	});

	await upsert(tables.apiKey, {
		id: "test-api-key-id",
		token: "test-token",
		projectId: "test-project-id",
		description: "Test API Key",
		createdBy: "test-user-id",
	});

	// Embeddable Payments SDK POC: a project with the SDK enabled and a 50%
	// end-user top-up bonus, plus a live platform secret key, so the end-user
	// wallet + bonus flow can be exercised end-to-end locally (mint a session with
	// the platform secret, top up as an end-user, get +50% credit). The bonus is
	// funded from this org's credit balance, so it is seeded with credits.
	await upsert(tables.organization, {
		id: "sdk-poc-org-id",
		name: "Payments SDK POC",
		billingEmail: "admin@example.com",
		credits: 100,
		retentionLevel: "retain",
	});

	await upsert(tables.userOrganization, {
		id: "sdk-poc-user-org-id",
		userId: "test-user-id",
		organizationId: "sdk-poc-org-id",
		role: "owner",
	});

	await upsert(tables.project, {
		id: "sdk-poc-project-id",
		name: "Payments SDK POC",
		organizationId: "sdk-poc-org-id",
		mode: "credits",
		paymentsSdkEnabled: true,
		endUserEnabled: true,
		endUserTopUpBonusPercent: "50",
	});

	// Live-mode platform secret (token does not start with `sk_test_`), so minted
	// sessions/wallets are live and eligible for the developer-funded bonus.
	await upsert(tables.apiKey, {
		id: "sdk-poc-platform-secret-id",
		token: "sk_pocbonus_live_secret",
		projectId: "sdk-poc-project-id",
		description: "Payments SDK POC platform secret",
		keyType: "platform_secret",
		createdBy: "test-user-id",
	});

	// Personal org for the test admin so DevPass Pro is available locally
	await upsert(tables.organization, {
		id: "test-personal-org-id",
		name: "Test User's Workspace",
		billingEmail: "admin@example.com",
		credits: 0,
		retentionLevel: "retain",
		plan: "free",
		kind: "devpass",
		devPlan: "pro",
		devPlanCycle: "monthly",
		devPlanCreditsUsed: "0",
		devPlanCreditsLimit: String(getDevPlanCreditsLimit("pro")),
		devPlanBillingCycleStart: new Date(),
	});

	await upsert(tables.userOrganization, {
		id: "test-personal-user-org-id",
		userId: "test-user-id",
		organizationId: "test-personal-org-id",
		role: "owner",
	});

	await upsert(tables.project, {
		id: "test-personal-project-id",
		name: "Default Project",
		organizationId: "test-personal-org-id",
		mode: "credits",
	});

	await upsert(tables.apiKey, {
		id: "test-devpass-api-key-id",
		token: "llmgdev_devpass_test_token",
		projectId: "test-personal-project-id",
		description: "Dev Plan API Key",
		createdBy: "test-user-id",
	});

	// Realistic per-agent activity for the DevPass dashboard and the public
	// /apps page. Each agent has its own mix of models so per-agent charts show
	// a breakdown across multiple models. Weights are renormalized internally
	// so it's safe to add or reorder entries.
	interface DevpassAgentModel {
		model: string;
		provider: string;
		weight: number;
	}
	const DEVPASS_AGENTS: Array<{
		source: string;
		weight: number;
		models: DevpassAgentModel[];
	}> = [
		{
			source: "claude.com/claude-code",
			weight: 0.22,
			models: [
				{ model: "claude-3.5-sonnet", provider: "anthropic", weight: 0.7 },
				{ model: "claude-3-haiku", provider: "anthropic", weight: 0.2 },
				{ model: "claude-3-opus", provider: "anthropic", weight: 0.1 },
			],
		},
		{
			source: "cursor",
			weight: 0.14,
			models: [
				{ model: "gpt-4o", provider: "openai", weight: 0.45 },
				{ model: "claude-3.5-sonnet", provider: "anthropic", weight: 0.35 },
				{ model: "gpt-4o-mini", provider: "openai", weight: 0.15 },
				{ model: "o1", provider: "openai", weight: 0.05 },
			],
		},
		{
			source: "cline",
			weight: 0.1,
			models: [
				{ model: "claude-3.5-sonnet", provider: "anthropic", weight: 0.7 },
				{ model: "gpt-4o", provider: "openai", weight: 0.2 },
				{ model: "deepseek-chat", provider: "deepseek", weight: 0.1 },
			],
		},
		{
			source: "codex",
			weight: 0.08,
			models: [
				{ model: "o1", provider: "openai", weight: 0.55 },
				{ model: "o3-mini", provider: "openai", weight: 0.3 },
				{ model: "gpt-4o", provider: "openai", weight: 0.15 },
			],
		},
		{
			source: "opencode",
			weight: 0.07,
			models: [
				{ model: "claude-3-haiku", provider: "anthropic", weight: 0.5 },
				{ model: "claude-3.5-sonnet", provider: "anthropic", weight: 0.3 },
				{ model: "gpt-4o-mini", provider: "openai", weight: 0.2 },
			],
		},
		{
			source: "aider",
			weight: 0.06,
			models: [
				{ model: "claude-3.5-sonnet", provider: "anthropic", weight: 0.55 },
				{ model: "gpt-4o", provider: "openai", weight: 0.3 },
				{ model: "deepseek-chat", provider: "deepseek", weight: 0.15 },
			],
		},
		{
			source: "continue.dev",
			weight: 0.05,
			models: [
				{ model: "claude-3.5-sonnet", provider: "anthropic", weight: 0.5 },
				{ model: "gpt-4o-mini", provider: "openai", weight: 0.3 },
				{ model: "deepseek-chat", provider: "deepseek", weight: 0.2 },
			],
		},
		{
			source: "windsurf",
			weight: 0.05,
			models: [
				{ model: "gpt-4o", provider: "openai", weight: 0.5 },
				{ model: "claude-3.5-sonnet", provider: "anthropic", weight: 0.35 },
				{ model: "gpt-4o-mini", provider: "openai", weight: 0.15 },
			],
		},
		{
			source: "roo-cline",
			weight: 0.04,
			models: [
				{ model: "claude-3.5-sonnet", provider: "anthropic", weight: 0.65 },
				{ model: "gpt-4o", provider: "openai", weight: 0.25 },
				{ model: "claude-3-haiku", provider: "anthropic", weight: 0.1 },
			],
		},
		{
			source: "kilo-code",
			weight: 0.03,
			models: [
				{ model: "deepseek-chat", provider: "deepseek", weight: 0.6 },
				{ model: "claude-3.5-sonnet", provider: "anthropic", weight: 0.25 },
				{ model: "gpt-4o-mini", provider: "openai", weight: 0.15 },
			],
		},
		{
			source: "zed",
			weight: 0.03,
			models: [
				{ model: "claude-3.5-sonnet", provider: "anthropic", weight: 0.6 },
				{ model: "gpt-4o", provider: "openai", weight: 0.25 },
				{ model: "claude-3-haiku", provider: "anthropic", weight: 0.15 },
			],
		},
		{
			source: "bolt.new",
			weight: 0.03,
			models: [
				{ model: "claude-3.5-sonnet", provider: "anthropic", weight: 0.65 },
				{ model: "gpt-4o", provider: "openai", weight: 0.25 },
				{ model: "gpt-4o-mini", provider: "openai", weight: 0.1 },
			],
		},
		{
			source: "v0.dev",
			weight: 0.025,
			models: [
				{ model: "gpt-4o", provider: "openai", weight: 0.55 },
				{ model: "claude-3.5-sonnet", provider: "anthropic", weight: 0.35 },
				{ model: "gpt-4o-mini", provider: "openai", weight: 0.1 },
			],
		},
		{
			source: "lovable.dev",
			weight: 0.025,
			models: [
				{ model: "claude-3.5-sonnet", provider: "anthropic", weight: 0.6 },
				{ model: "gpt-4o", provider: "openai", weight: 0.3 },
				{ model: "claude-3-haiku", provider: "anthropic", weight: 0.1 },
			],
		},
		{
			source: "autohand",
			weight: 0.02,
			models: [
				{ model: "deepseek-chat", provider: "deepseek", weight: 0.55 },
				{ model: "claude-3.5-sonnet", provider: "anthropic", weight: 0.3 },
				{ model: "gpt-4o-mini", provider: "openai", weight: 0.15 },
			],
		},
		{
			source: "empryo",
			weight: 0.02,
			models: [
				{ model: "claude-3.5-sonnet", provider: "anthropic", weight: 0.55 },
				{
					model: "gemini-2.0-flash",
					provider: "google-ai-studio",
					weight: 0.3,
				},
				{ model: "gpt-4o-mini", provider: "openai", weight: 0.15 },
			],
		},
		{
			source: "soulforge",
			weight: 0.02,
			models: [
				{
					model: "gemini-2.0-flash",
					provider: "google-ai-studio",
					weight: 0.6,
				},
				{ model: "claude-3-haiku", provider: "anthropic", weight: 0.25 },
				{ model: "gemini-1.5-pro", provider: "google-ai-studio", weight: 0.15 },
			],
		},
		{
			source: "openclaw",
			weight: 0.015,
			models: [
				{ model: "claude-3-haiku", provider: "anthropic", weight: 0.55 },
				{ model: "claude-3.5-sonnet", provider: "anthropic", weight: 0.3 },
				{ model: "gpt-4o-mini", provider: "openai", weight: 0.15 },
			],
		},
		{
			source: "n8n",
			weight: 0.015,
			models: [
				{ model: "gpt-4o-mini", provider: "openai", weight: 0.55 },
				{ model: "gpt-4o", provider: "openai", weight: 0.3 },
				{ model: "claude-3-haiku", provider: "anthropic", weight: 0.15 },
			],
		},
	];
	const DEVPASS_LOG_COUNT = 1800;
	const DEVPASS_WEIGHT_TOTAL = DEVPASS_AGENTS.reduce(
		(sum, a) => sum + a.weight,
		0,
	);
	const devpassLogs: Array<Record<string, any>> = [];
	let devpassRunningCost = 0;
	for (let i = 0; i < DEVPASS_LOG_COUNT; i++) {
		const r = secureRandom() * DEVPASS_WEIGHT_TOTAL;
		let acc = 0;
		const agent =
			DEVPASS_AGENTS.find((a) => {
				acc += a.weight;
				return r <= acc;
			}) ?? DEVPASS_AGENTS[0];
		const agentModel = weightedRandomChoice(agent.models);
		const modelDef =
			MODELS.find(
				(m) =>
					m.model === agentModel.model && m.provider === agentModel.provider,
			) ?? MODELS[0];
		const finishDef = weightedRandomChoice(FINISH_REASONS);
		const isError =
			finishDef.unified === "upstream_error" ||
			finishDef.unified === "gateway_error" ||
			finishDef.unified === "client_error";
		const minutesBack = randomInt(0, 30 * 24 * 60);
		/* eslint-disable no-mixed-operators */
		const createdAt = new Date(Date.now() - minutesBack * 60 * 1000);
		/* eslint-enable no-mixed-operators */
		const promptTokens = randomInt(800, 18000);
		const completionTokens = isError ? 0 : randomInt(60, 4500);
		const totalTokens = promptTokens + completionTokens;
		const cachedTokens =
			secureRandom() < 0.3 ? randomInt(50, promptTokens / 2) : 0;
		const isStreamed = secureRandom() < 0.85;
		const duration = isError ? randomInt(80, 600) : randomInt(450, 22000);
		const inputCost = (promptTokens / 1000) * modelDef.inputPrice;
		const outputCost = (completionTokens / 1000) * modelDef.outputPrice;
		const cost = Number((inputCost + outputCost).toFixed(6));
		devpassRunningCost += cost;
		devpassLogs.push({
			id: `devpass-log-${i}`,
			requestId: `devpass-req-${i}`,
			createdAt,
			updatedAt: createdAt,
			organizationId: "test-personal-org-id",
			projectId: "test-personal-project-id",
			apiKeyId: "test-devpass-api-key-id",
			duration,
			timeToFirstToken:
				isStreamed && !isError ? randomInt(80, Math.min(duration, 2200)) : null,
			requestedModel: modelDef.model,
			usedModel: modelDef.model,
			usedProvider: modelDef.provider,
			source: agent.source,
			responseSize: isError ? 0 : randomInt(500, 18000),
			content: isError ? null : "Generated coding response.",
			finishReason: finishDef.reason,
			unifiedFinishReason: finishDef.unified,
			promptTokens: String(promptTokens),
			completionTokens: String(completionTokens),
			totalTokens: String(totalTokens),
			cachedTokens: String(cachedTokens),
			temperature: randomFloat(0, 0.4, 2),
			maxTokens: randomChoice([2048, 4096, 8192, 16384]),
			messages: JSON.stringify([
				{ role: "user", content: "Refactor the auth middleware…" },
			]),
			cost,
			inputCost: Number(inputCost.toFixed(6)),
			outputCost: Number(outputCost.toFixed(6)),
			hasError: isError,
			errorDetails: isError
				? {
						statusCode: randomChoice([429, 500, 502, 503]),
						statusText: "Error",
						responseText: "Provider returned an error",
					}
				: undefined,
			mode: "credits" as const,
			usedMode: "credits" as const,
			streamed: isStreamed,
			cached: cachedTokens > 0,
			discount: 0,
		});
	}
	await bulkInsert(tables.log, devpassLogs);

	// Hourly stats so /activity (used by the usage chart) returns data
	const devpassHourlyStats: Array<Record<string, any>> = [];
	for (let h = 0; h < 30 * 24; h++) {
		const hourTs = hoursAgo(h);
		hourTs.setMinutes(0, 0, 0);
		const baseRequests = randomInt(0, 14);
		if (baseRequests === 0) {
			continue;
		}
		const errorCount = Math.floor(baseRequests * randomFloat(0, 0.06));
		const cacheCount = Math.floor(baseRequests * randomFloat(0, 0.25));
		const streamedCount = Math.floor(baseRequests * randomFloat(0.6, 0.95));
		const inputTokens = baseRequests * randomInt(900, 6000);
		const outputTokens = baseRequests * randomInt(200, 2200);
		const costPerReq = randomFloat(0.02, 0.18);
		const totalCost = baseRequests * costPerReq;
		devpassHourlyStats.push({
			id: `devpass-phs-${h}`,
			projectId: "test-personal-project-id",
			hourTimestamp: hourTs,
			requestCount: baseRequests,
			errorCount,
			cacheCount,
			streamedCount,
			nonStreamedCount: baseRequests - streamedCount,
			completedCount: baseRequests - errorCount,
			lengthLimitCount: 0,
			contentFilterCount: 0,
			toolCallsCount: randomInt(0, Math.floor(baseRequests * 0.3)),
			canceledCount: 0,
			unknownFinishCount: 0,
			clientErrorCount: 0,
			gatewayErrorCount: 0,
			upstreamErrorCount: errorCount,
			inputTokens: String(inputTokens),
			outputTokens: String(outputTokens),
			totalTokens: String(inputTokens + outputTokens),
			reasoningTokens: "0",
			cachedTokens: String(Math.floor(inputTokens * 0.15)),
			cost: Number(totalCost.toFixed(4)),
			inputCost: Number((totalCost * 0.55).toFixed(4)),
			outputCost: Number((totalCost * 0.4).toFixed(4)),
			requestCost: Number((totalCost * 0.05).toFixed(4)),
			dataStorageCost: 0,
			discountSavings: 0,
			imageInputCost: 0,
			imageOutputCost: 0,
			cachedInputCost: 0,
			creditsRequestCount: baseRequests,
			apiKeysRequestCount: 0,
			creditsCost: Number(totalCost.toFixed(4)),
			apiKeysCost: 0,
			creditsDataStorageCost: 0,
			apiKeysDataStorageCost: 0,
		});
	}
	await bulkInsert(tables.projectHourlyStats, devpassHourlyStats);

	// Split each hourly bucket across a few models so the Model Usage Overview chart has data.
	const devpassModels: Array<{ provider: string; model: string }> = [
		{ provider: "anthropic", model: "claude-3.5-sonnet" },
		{ provider: "openai", model: "gpt-4o" },
		{ provider: "anthropic", model: "claude-3-haiku" },
		{ provider: "openai", model: "gpt-4o-mini" },
	];
	const devpassHourlyModelStats: Array<Record<string, any>> = [];
	for (const bucket of devpassHourlyStats) {
		const splits = devpassModels.map(() => randomFloat(0.1, 1));
		const splitTotal = splits.reduce((a, b) => a + b, 0);
		const weights = splits.map((w) => w / splitTotal);
		devpassModels.forEach((m, i) => {
			const w = weights[i];
			const reqs = Math.round(bucket.requestCount * w);
			const inTok = Math.round(Number(bucket.inputTokens) * w);
			const outTok = Math.round(Number(bucket.outputTokens) * w);
			const streamed = Math.floor(bucket.streamedCount * w);
			const errors = Math.floor(bucket.errorCount * w);
			devpassHourlyModelStats.push({
				id: `devpass-phms-${bucket.id}-${i}`,
				projectId: "test-personal-project-id",
				hourTimestamp: bucket.hourTimestamp,
				usedModel: m.model,
				usedProvider: m.provider,
				requestCount: reqs,
				errorCount: errors,
				cacheCount: Math.floor(bucket.cacheCount * w),
				streamedCount: streamed,
				nonStreamedCount: Math.max(0, reqs - streamed),
				completedCount: Math.max(0, reqs - errors),
				lengthLimitCount: 0,
				contentFilterCount: 0,
				toolCallsCount: 0,
				canceledCount: 0,
				unknownFinishCount: 0,
				clientErrorCount: 0,
				gatewayErrorCount: 0,
				upstreamErrorCount: 0,
				inputTokens: String(inTok),
				outputTokens: String(outTok),
				totalTokens: String(inTok + outTok),
				reasoningTokens: "0",
				cachedTokens: String(Math.floor(Number(bucket.cachedTokens) * w)),
				cacheWriteTokens: "0",
				cost: Number((bucket.cost * w).toFixed(4)),
				inputCost: Number((bucket.inputCost * w).toFixed(4)),
				outputCost: Number((bucket.outputCost * w).toFixed(4)),
				requestCost: Number((bucket.requestCost * w).toFixed(4)),
				dataStorageCost: 0,
				discountSavings: 0,
				imageInputCost: 0,
				imageOutputCost: 0,
				audioInputCost: 0,
				videoOutputCost: 0,
				cachedInputCost: 0,
				cacheWriteInputCost: 0,
				creditsRequestCount: reqs,
				apiKeysRequestCount: 0,
				creditsCost: Number((bucket.cost * w).toFixed(4)),
				apiKeysCost: 0,
				creditsDataStorageCost: 0,
				apiKeysDataStorageCost: 0,
			});
		});
	}
	await bulkInsert(tables.projectHourlyModelStats, devpassHourlyModelStats);

	// Split each hourly bucket across coding-agent sources so the Agents
	// dashboard and the DevPass "Top coding agents" breakdown have data.
	const devpassHourlySourceStats: Array<Record<string, any>> = [];
	for (const bucket of devpassHourlyStats) {
		const splits = DEVPASS_AGENTS.map((a) => a.weight * randomFloat(0.5, 1.5));
		const splitTotal = splits.reduce((a, b) => a + b, 0);
		const weights = splits.map((w) => w / splitTotal);
		DEVPASS_AGENTS.forEach((agent, i) => {
			const w = weights[i];
			const reqs = Math.round(bucket.requestCount * w);
			if (reqs === 0) {
				return;
			}
			const inTok = Math.round(Number(bucket.inputTokens) * w);
			const outTok = Math.round(Number(bucket.outputTokens) * w);
			const streamed = Math.floor(bucket.streamedCount * w);
			const errors = Math.floor(bucket.errorCount * w);
			devpassHourlySourceStats.push({
				id: `devpass-phss-${bucket.id}-${i}`,
				projectId: "test-personal-project-id",
				hourTimestamp: bucket.hourTimestamp,
				source: agent.source,
				requestCount: reqs,
				errorCount: errors,
				cacheCount: Math.floor(bucket.cacheCount * w),
				streamedCount: streamed,
				nonStreamedCount: Math.max(0, reqs - streamed),
				completedCount: Math.max(0, reqs - errors),
				lengthLimitCount: 0,
				contentFilterCount: 0,
				toolCallsCount: 0,
				canceledCount: 0,
				unknownFinishCount: 0,
				clientErrorCount: 0,
				gatewayErrorCount: 0,
				upstreamErrorCount: 0,
				inputTokens: String(inTok),
				outputTokens: String(outTok),
				totalTokens: String(inTok + outTok),
				reasoningTokens: "0",
				cachedTokens: String(Math.floor(Number(bucket.cachedTokens) * w)),
				cacheWriteTokens: "0",
				cost: Number((bucket.cost * w).toFixed(4)),
				inputCost: Number((bucket.inputCost * w).toFixed(4)),
				outputCost: Number((bucket.outputCost * w).toFixed(4)),
				requestCost: Number((bucket.requestCost * w).toFixed(4)),
				dataStorageCost: 0,
				discountSavings: 0,
				imageInputCost: 0,
				imageOutputCost: 0,
				audioInputCost: 0,
				videoOutputCost: 0,
				cachedInputCost: 0,
				cacheWriteInputCost: 0,
				creditsRequestCount: reqs,
				apiKeysRequestCount: 0,
				creditsCost: Number((bucket.cost * w).toFixed(4)),
				apiKeysCost: 0,
				creditsDataStorageCost: 0,
				apiKeysDataStorageCost: 0,
			});
		});
	}
	await bulkInsert(tables.projectHourlySourceStats, devpassHourlySourceStats);

	// Sync the personal org's used-credits to roughly match the seeded spend
	// so the usage bar in the dashboard reflects this activity.
	const usedCredits = Math.min(
		devpassRunningCost,
		getDevPlanCreditsLimit("pro") * 0.65,
	);
	await upsert(tables.organization, {
		id: "test-personal-org-id",
		name: "Test User's Workspace",
		billingEmail: "admin@example.com",
		credits: 0,
		retentionLevel: "retain",
		plan: "free",
		kind: "devpass",
		devPlan: "pro",
		devPlanCycle: "monthly",
		devPlanCreditsUsed: usedCredits.toFixed(4),
		devPlanCreditsLimit: String(getDevPlanCreditsLimit("pro")),
		devPlanBillingCycleStart: daysAgo(12),
	});

	await upsert(tables.user, {
		id: "enterprise-user-id",
		name: "Enterprise User",
		// Login: enterprise@example.com / enterprise@example.com (password == email)
		email: "enterprise@example.com",
		emailVerified: true,
	});

	await upsert(tables.account, {
		id: "enterprise-account-id",
		providerId: "credential",
		accountId: "enterprise-account-id",
		password: await hashPassword("enterprise@example.com"),
		userId: "enterprise-user-id",
	});

	await upsert(tables.organization, {
		id: "enterprise-org-id",
		name: "Enterprise Organization",
		billingEmail: "enterprise@example.com",
		credits: 1000,
		retentionLevel: "retain",
		plan: "enterprise",
	});

	await upsert(tables.userOrganization, {
		id: "enterprise-user-org-id",
		userId: "enterprise-user-id",
		organizationId: "enterprise-org-id",
		role: "owner",
	});

	// Also make the default admin (admin@example.com) an admin of the enterprise
	// org so it can be reached by switching orgs with the same login.
	await upsert(tables.userOrganization, {
		id: "enterprise-admin-user-org-id",
		userId: "test-user-id",
		organizationId: "enterprise-org-id",
		role: "admin",
	});

	await upsert(tables.project, {
		id: "enterprise-project-id",
		name: "Enterprise Project",
		organizationId: "enterprise-org-id",
		mode: "hybrid",
	});

	// A second project in the enterprise org, so the developer below has a
	// project they are NOT granted access to (for testing project-scoped RBAC).
	await upsert(tables.project, {
		id: "enterprise-project-secondary-id",
		name: "Restricted Project",
		organizationId: "enterprise-org-id",
		mode: "hybrid",
	});

	await upsert(tables.apiKey, {
		id: "enterprise-api-key-id",
		token: "test-enterprise",
		projectId: "enterprise-project-id",
		description: "Enterprise API Key",
		createdBy: "enterprise-user-id",
	});

	// A project-scoped "developer" member of the enterprise org — limited to the
	// Enterprise Project only — for testing the RBAC/developer experience. Log in
	// as developer@example.com with the password developer@example.com (== email).
	await upsert(tables.user, {
		id: "enterprise-dev-user-id",
		name: "Enterprise Developer",
		email: "developer@example.com",
		emailVerified: true,
		onboardingCompleted: true,
	});

	await upsert(tables.account, {
		id: "enterprise-dev-account-id",
		providerId: "credential",
		accountId: "enterprise-dev-account-id",
		password: await hashPassword("developer@example.com"),
		userId: "enterprise-dev-user-id",
	});

	await upsert(tables.userOrganization, {
		id: "enterprise-dev-user-org-id",
		userId: "enterprise-dev-user-id",
		organizationId: "enterprise-org-id",
		role: "developer",
		// A sample budget so the developer sees the caps an admin set on them.
		maxApiKeys: 3,
		usageLimit: "50",
		periodUsageLimit: "10",
		periodUsageDurationValue: 1,
		periodUsageDurationUnit: "day",
	});

	// Grant the developer access to the Enterprise Project only (not the
	// restricted one above).
	await upsert(tables.userProject, {
		id: "enterprise-dev-user-project-id",
		userOrganizationId: "enterprise-dev-user-org-id",
		projectId: "enterprise-project-id",
	});

	// A key the developer created, so their own-usage view has something to show.
	await upsert(tables.apiKey, {
		id: "enterprise-dev-api-key-id",
		token: "test-enterprise-dev",
		projectId: "enterprise-project-id",
		description: "Enterprise Developer API Key",
		createdBy: "enterprise-dev-user-id",
	});

	await Promise.all(logs.map((log) => upsert(tables.log, log)));

	await upsert(tables.transaction, {
		id: "test-transaction-id",
		organizationId: "test-org-id",
		type: "credit_topup",
		amount: "200",
		creditAmount: "200",
		currency: "USD",
		status: "completed",
		description: "Test credit top-up for referral eligibility",
	});

	const devpassRenewalCreatedAt = daysAgo(6);
	await upsert(tables.transaction, {
		id: "test-devpass-renewal-transaction-id",
		organizationId: "test-personal-org-id",
		createdAt: devpassRenewalCreatedAt,
		updatedAt: devpassRenewalCreatedAt,
		type: "dev_plan_renewal",
		amount: "79",
		creditAmount: String(getDevPlanCreditsLimit("pro")),
		currency: "USD",
		status: "completed",
		stripePaymentIntentId: "pi_seed_devpass_renewal",
		stripeInvoiceId: "in_seed_devpass_renewal",
		description: "Seeded DevPass Pro renewal for admin dashboard",
	});

	const devpassRefundCreatedAt = new Date();
	await upsert(tables.transaction, {
		id: "test-devpass-refund-transaction-id",
		organizationId: "test-personal-org-id",
		createdAt: devpassRefundCreatedAt,
		updatedAt: devpassRefundCreatedAt,
		type: "credit_refund",
		amount: "15",
		creditAmount: "0",
		currency: "USD",
		status: "completed",
		stripePaymentIntentId: "pi_seed_devpass_renewal",
		stripeRefundId: "re_seed_devpass_refund",
		relatedTransactionId: "test-devpass-renewal-transaction-id",
		refundReason: "requested_by_customer",
		description: "Seeded DevPass refund for admin dashboard",
	});

	// ── Bulk seed data for admin dashboard ──
	// Seed extra users
	for (const u of EXTRA_USERS) {
		await upsert(tables.user, {
			id: u.id,
			name: u.name,
			email: u.email,
			emailVerified: secureRandom() < 0.85,
			onboardingCompleted: secureRandom() < 0.7,
			createdAt: daysAgo(randomInt(10, 400)),
		});
		await upsert(tables.account, {
			id: `account-${u.id}`,
			providerId: "credential",
			accountId: `account-${u.id}`,
			// Password == email, e.g. alice.chen@techcorp.io logs in with that string.
			password: await hashPassword(u.email),
			userId: u.id,
		});
	}

	// Seed extra organizations
	for (const org of EXTRA_ORGS) {
		await upsert(tables.organization, {
			id: org.id,
			name: org.name,
			billingEmail: org.billingEmail,
			plan: org.plan,
			credits: org.credits,
			retentionLevel:
				org.plan === "enterprise"
					? "retain"
					: secureRandom() < 0.5
						? "retain"
						: "none",
			status: org.status,
			kind: org.kind,
			devPlan: org.devPlan,
			devPlanCreditsUsed:
				org.devPlan !== "none" ? String(randomFloat(0, 20)) : "0",
			devPlanCreditsLimit:
				org.devPlan === "lite"
					? "15"
					: org.devPlan === "pro"
						? "50"
						: org.devPlan === "max"
							? "200"
							: "0",
			createdAt: org.createdAt,
		});
	}

	// Seed user-org relationships
	for (let i = 0; i < USER_ORG_MAP.length; i++) {
		const mapping = USER_ORG_MAP[i]!;
		await upsert(tables.userOrganization, {
			id: `user-org-${i}`,
			userId: mapping.userId,
			organizationId: mapping.orgId,
			role: mapping.role,
		});
	}

	// Yearly model-survey (census) responses so the public /data/<year>
	// registry has content locally. Three models cross the 5-response
	// anonymity threshold; gpt-4o-mini stays below it to exercise the
	// hidden-model state.
	const censusYear = new Date().getUTCFullYear();
	const censusRespondents = [
		{ userId: "user-alice", organizationId: "org-personal-alice" },
		{ userId: "user-bob", organizationId: "org-personal-alice" },
		{ userId: "user-carol", organizationId: "org-personal-dave" },
		{ userId: "user-dave", organizationId: "org-personal-dave" },
		{ userId: "user-elena", organizationId: "org-personal-maya" },
		{ userId: "user-frank", organizationId: "org-personal-maya" },
		{ userId: "user-grace", organizationId: "org-personal-alice" },
	];
	const censusModels: Array<{
		modelId: string;
		responses: Array<{
			valueScore: number;
			qualityScore: number;
			speedScore: number;
			wouldRecommend: boolean;
			primaryUseCase: string;
		}>;
	}> = [
		{
			modelId: "claude-3.5-sonnet",
			responses: [
				{
					valueScore: 5,
					qualityScore: 5,
					speedScore: 4,
					wouldRecommend: true,
					primaryUseCase: "agentic_coding",
				},
				{
					valueScore: 4,
					qualityScore: 5,
					speedScore: 4,
					wouldRecommend: true,
					primaryUseCase: "agentic_coding",
				},
				{
					valueScore: 5,
					qualityScore: 4,
					speedScore: 3,
					wouldRecommend: true,
					primaryUseCase: "code_review",
				},
				{
					valueScore: 4,
					qualityScore: 5,
					speedScore: 4,
					wouldRecommend: true,
					primaryUseCase: "agentic_coding",
				},
				{
					valueScore: 5,
					qualityScore: 4,
					speedScore: 4,
					wouldRecommend: true,
					primaryUseCase: "debugging",
				},
				{
					valueScore: 4,
					qualityScore: 5,
					speedScore: 3,
					wouldRecommend: true,
					primaryUseCase: "agentic_coding",
				},
				{
					valueScore: 5,
					qualityScore: 5,
					speedScore: 4,
					wouldRecommend: true,
					primaryUseCase: "writing_tests",
				},
			],
		},
		{
			modelId: "gpt-4o",
			responses: [
				{
					valueScore: 4,
					qualityScore: 4,
					speedScore: 4,
					wouldRecommend: true,
					primaryUseCase: "agentic_coding",
				},
				{
					valueScore: 4,
					qualityScore: 4,
					speedScore: 5,
					wouldRecommend: true,
					primaryUseCase: "debugging",
				},
				{
					valueScore: 3,
					qualityScore: 4,
					speedScore: 4,
					wouldRecommend: false,
					primaryUseCase: "code_completion",
				},
				{
					valueScore: 4,
					qualityScore: 5,
					speedScore: 4,
					wouldRecommend: true,
					primaryUseCase: "agentic_coding",
				},
				{
					valueScore: 4,
					qualityScore: 4,
					speedScore: 5,
					wouldRecommend: true,
					primaryUseCase: "docs_and_explanations",
				},
				{
					valueScore: 3,
					qualityScore: 4,
					speedScore: 4,
					wouldRecommend: true,
					primaryUseCase: "code_review",
				},
			],
		},
		{
			modelId: "claude-3-haiku",
			responses: [
				{
					valueScore: 5,
					qualityScore: 3,
					speedScore: 5,
					wouldRecommend: true,
					primaryUseCase: "code_completion",
				},
				{
					valueScore: 4,
					qualityScore: 3,
					speedScore: 5,
					wouldRecommend: true,
					primaryUseCase: "code_completion",
				},
				{
					valueScore: 4,
					qualityScore: 4,
					speedScore: 5,
					wouldRecommend: true,
					primaryUseCase: "docs_and_explanations",
				},
				{
					valueScore: 5,
					qualityScore: 3,
					speedScore: 5,
					wouldRecommend: false,
					primaryUseCase: "debugging",
				},
				{
					valueScore: 4,
					qualityScore: 3,
					speedScore: 5,
					wouldRecommend: true,
					primaryUseCase: "code_completion",
				},
			],
		},
		{
			modelId: "gpt-4o-mini",
			responses: [
				{
					valueScore: 4,
					qualityScore: 3,
					speedScore: 5,
					wouldRecommend: true,
					primaryUseCase: "code_completion",
				},
				{
					valueScore: 3,
					qualityScore: 3,
					speedScore: 5,
					wouldRecommend: false,
					primaryUseCase: "other",
				},
				{
					valueScore: 4,
					qualityScore: 3,
					speedScore: 4,
					wouldRecommend: true,
					primaryUseCase: "docs_and_explanations",
				},
				{
					valueScore: 4,
					qualityScore: 2,
					speedScore: 5,
					wouldRecommend: true,
					primaryUseCase: "code_completion",
				},
			],
		},
	];
	const censusResponses: Array<Record<string, any>> = [];
	for (const model of censusModels) {
		model.responses.forEach((response, i) => {
			const respondent = censusRespondents[i % censusRespondents.length];
			const createdAt = daysAgo(randomInt(1, 20));
			censusResponses.push({
				id: `census-${model.modelId}-${i}`,
				year: censusYear,
				quarter: Math.floor(createdAt.getUTCMonth() / 3) + 1,
				userId: respondent.userId,
				organizationId: respondent.organizationId,
				modelId: model.modelId,
				...response,
				comment: null,
				requestCount: randomInt(60, 900),
				devPlanTier: "pro",
				rewardTier: null,
				createdAt,
			});
		});
	}
	await bulkInsert(tables.modelSurveyResponse, censusResponses);

	const projects = generateProjects();
	for (const proj of projects) {
		await upsert(tables.project, {
			id: proj.id,
			name: proj.name,
			organizationId: proj.orgId,
			mode: proj.mode,
			cachingEnabled: secureRandom() < 0.3,
		});
	}

	const apiKeys = generateApiKeys(projects);
	for (const key of apiKeys) {
		await upsert(tables.apiKey, {
			id: key.id,
			token: key.token,
			projectId: key.projectId,
			description: key.description,
			createdBy: key.createdBy,
			usage: key.usage,
		});
	}

	const generatedLogs = generateLogs(projects, apiKeys);
	await bulkInsert(tables.log, generatedLogs);

	const transactions = generateTransactions();
	await bulkInsert(tables.transaction, transactions);

	const discounts = generateDiscounts();
	await bulkInsert(tables.discount, discounts);

	const auditLogs = generateAuditLogs();
	await bulkInsert(tables.auditLog, auditLogs);

	const hourlyStats = generateProjectHourlyStats(projects);
	await bulkInsert(tables.projectHourlyStats, hourlyStats);

	const hourlyModelStats = generateProjectHourlyModelStats(projects);
	await bulkInsert(tables.projectHourlyModelStats, hourlyModelStats);

	const hourlySourceStats = generateProjectHourlySourceStats(projects);
	await bulkInsert(tables.projectHourlySourceStats, hourlySourceStats);

	// Seed agent source stats for the default "Test Project" so the Agents
	// dashboard the test user lands on shows activity out of the box.
	const testProjectSourceStats: Array<Record<string, any>> = [];
	let testSourceIdx = 0;
	for (let h = 0; h < 30 * 24; h++) {
		const hourTs = hoursAgo(h);
		hourTs.setMinutes(0, 0, 0);
		for (const sourceDef of AGENT_SOURCES) {
			if (secureRandom() < 0.45) {
				continue;
			}
			const reqCount = randomInt(1, 12);
			const errCount = secureRandom() < 0.1 ? randomInt(1, 2) : 0;
			const inputTok = reqCount * randomInt(200, 4000);
			const outputTok = reqCount * randomInt(100, 2500);
			const costVal = reqCount * randomFloat(0.002, 0.06);
			testProjectSourceStats.push({
				id: `test-phss-${testSourceIdx}`,
				projectId: "test-project-id",
				hourTimestamp: hourTs,
				source: sourceDef.source,
				requestCount: reqCount,
				errorCount: errCount,
				cacheCount: randomInt(0, Math.floor(reqCount * 0.2)),
				streamedCount: Math.floor(reqCount * 0.6),
				nonStreamedCount: Math.floor(reqCount * 0.4),
				completedCount: reqCount - errCount,
				lengthLimitCount: 0,
				contentFilterCount: 0,
				toolCallsCount: randomInt(0, 2),
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
				inputCost: Number((costVal * 0.4).toFixed(6)),
				outputCost: Number((costVal * 0.5).toFixed(6)),
				requestCost: Number((costVal * 0.1).toFixed(6)),
				dataStorageCost: 0,
				discountSavings: 0,
				imageInputCost: 0,
				imageOutputCost: 0,
				audioInputCost: 0,
				videoOutputCost: 0,
				cachedInputCost: 0,
				cacheWriteInputCost: 0,
				creditsRequestCount: Math.floor(reqCount * 0.6),
				apiKeysRequestCount: Math.floor(reqCount * 0.4),
				creditsCost: Number((costVal * 0.6).toFixed(6)),
				apiKeysCost: Number((costVal * 0.4).toFixed(6)),
				creditsDataStorageCost: 0,
				apiKeysDataStorageCost: 0,
			});
			testSourceIdx++;
		}
	}
	await bulkInsert(tables.projectHourlySourceStats, testProjectSourceStats);

	// Seed providers, models, and mappings
	const seedProviders = generateSeedProviders();
	await bulkInsert(tables.provider, seedProviders);

	const seedModels = generateSeedModels();
	await bulkInsert(tables.model, seedModels);

	const seedMappings = generateSeedModelProviderMappings();
	await bulkInsert(tables.modelProviderMapping, seedMappings);

	const seedMappingHistory =
		generateSeedModelProviderMappingHistory(seedMappings);
	await bulkInsert(tables.modelProviderMappingHistory, seedMappingHistory);

	const seedModelHistory = generateSeedModelHistory();
	await bulkInsert(tables.modelHistory, seedModelHistory);

	await upsert(tables.enterpriseContactSubmission, {
		id: "ecs_seed_1",
		name: "Sarah Chen",
		email: "sarah.chen@example.com",
		country: "United States",
		size: "201-500",
		message:
			"Hi, we're evaluating LLM Gateway for our engineering team of ~300 developers. We currently use a mix of OpenAI and Anthropic APIs directly and are looking for a unified gateway with usage tracking, cost controls, and SSO integration. Could we schedule a call to discuss enterprise pricing and onboarding?",
		spamFilterStatus: "delivered",
		ipAddress: "203.0.113.42",
		userAgent:
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	});

	await closeDatabase();
	await redisClient.quit();
}

void seed();
