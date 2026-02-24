import { randomUUID } from "crypto";

import { redisClient } from "@llmgateway/cache";
import {
	models as allModels,
	providers as allProviders,
} from "@llmgateway/models";

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

function randomInt(min: number, max: number) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number, decimals = 2) {
	/* eslint-disable no-mixed-operators */
	return Number((Math.random() * (max - min) + min).toFixed(decimals));
	/* eslint-enable no-mixed-operators */
}

function randomChoice<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)]!;
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

const PASSWORD_HASH =
	"c11ef27a7f9264be08db228ebb650888:a4d985a9c6bd98608237fd507534424950aa7fc255930d972242b81cbe78594f8568feb0d067e95ddf7be242ad3e9d013f695f4414fce68bfff091079f1dc460";

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
	let r = Math.random() * total;
	for (const item of arr) {
		r -= item.weight;
		if (r <= 0) {
			return item;
		}
	}
	return arr[arr.length - 1]!;
}

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
	isPersonal: boolean;
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
		isPersonal: false,
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
		isPersonal: false,
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
		isPersonal: false,
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
		isPersonal: false,
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
		isPersonal: false,
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
		isPersonal: false,
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
		isPersonal: false,
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
		isPersonal: false,
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
		isPersonal: false,
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
		isPersonal: false,
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
		isPersonal: false,
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
		isPersonal: false,
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
		isPersonal: false,
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
		isPersonal: false,
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
		isPersonal: false,
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
		isPersonal: true,
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
		isPersonal: true,
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
		isPersonal: true,
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
				Math.random() < 0.15 ? randomInt(5, promptTokens) : 0;
			const isCached = cachedTokens > 0;
			const isStreamed = Math.random() < 0.6;
			const duration = isError ? randomInt(50, 500) : randomInt(200, 15000);
			const timeToFirstToken =
				isStreamed && !isError ? randomInt(50, Math.min(duration, 2000)) : null;
			const inputCost = (promptTokens / 1000) * modelDef.inputPrice;
			const outputCost = (completionTokens / 1000) * modelDef.outputPrice;
			const cost = inputCost + outputCost;
			const discount = Math.random() < 0.1 ? randomFloat(0.05, 0.3) : 0;
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
				Math.random() < 0.85
					? "completed"
					: Math.random() < 0.5
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
				if (Math.random() < 0.3) {
					continue;
				}
				const reqCount = randomInt(1, isHighVolume ? 30 : 10);
				const errCount = Math.random() < 0.1 ? randomInt(1, 3) : 0;
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
			Math.random() < 0.3 ? randomFloat(200, 5000, 1) : null,
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
			Math.random() < 0.2 ? randomFloat(200, 6000, 1) : null,
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
				modelName: p.modelName,
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
				discount:
					p.discount !== undefined && p.discount !== null
						? String(p.discount)
						: "0",
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
	const topMappings = mappings.slice(0, 20);
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
	const topModels = (allModels as readonly ModelDefinition[]).slice(0, 15);
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
		email: "admin@example.com",
		emailVerified: true,
	});

	await upsert(tables.account, {
		id: "test-account-id",
		providerId: "credential",
		accountId: "test-account-id",
		password: PASSWORD_HASH,
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

	await upsert(tables.user, {
		id: "enterprise-user-id",
		name: "Enterprise User",
		email: "enterprise@example.com",
		emailVerified: true,
	});

	await upsert(tables.account, {
		id: "enterprise-account-id",
		providerId: "credential",
		accountId: "enterprise-account-id",
		password: PASSWORD_HASH,
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

	await upsert(tables.project, {
		id: "enterprise-project-id",
		name: "Enterprise Project",
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

	// ── Bulk seed data for admin dashboard ──
	// Seed extra users
	for (const u of EXTRA_USERS) {
		await upsert(tables.user, {
			id: u.id,
			name: u.name,
			email: u.email,
			emailVerified: Math.random() < 0.85,
			onboardingCompleted: Math.random() < 0.7,
			createdAt: daysAgo(randomInt(10, 400)),
		});
		await upsert(tables.account, {
			id: `account-${u.id}`,
			providerId: "credential",
			accountId: `account-${u.id}`,
			password: PASSWORD_HASH,
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
					: Math.random() < 0.5
						? "retain"
						: "none",
			status: org.status,
			isPersonal: org.isPersonal,
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

	const projects = generateProjects();
	for (const proj of projects) {
		await upsert(tables.project, {
			id: proj.id,
			name: proj.name,
			organizationId: proj.orgId,
			mode: proj.mode,
			cachingEnabled: Math.random() < 0.3,
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

	await closeDatabase();
	await redisClient.quit();
}

void seed();
