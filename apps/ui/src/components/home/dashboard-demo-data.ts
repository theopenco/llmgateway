import { addHours, format, parseISO, subDays } from "date-fns";

import {
	DEFAULT_ROUTING_RETRY,
	DEFAULT_ROUTING_WEIGHTS,
} from "@llmgateway/shared/routing-defaults";

import type {
	ActivityApiKeyUsage,
	ActivityModelUsage,
	ActivityUserUsage,
	DailyActivity,
} from "@/types/activity";

export const DEMO_ANCHOR_DAY = "2026-09-27";

export const DEMO_OPENED_AT = Date.UTC(2026, 8, 27, 14, 20);

const HISTORY_DAYS = 640;

export const DEMO_ORG = {
	id: "acme",
	name: "Acme Corp",
	logo: null,
	credits: 8420.5,
};

export const DEMO_USER = {
	name: "Maya Patel",
	email: "maya@acme.com",
	initials: "MP",
};

export interface DemoProject {
	id: string;
	name: string;
	scale: number;
	salt: number;
}

export const DEMO_PROJECTS: DemoProject[] = [
	{ id: "production-api", name: "Production API", scale: 1, salt: 0 },
	{ id: "internal-tools", name: "Internal Tools", scale: 0.24, salt: 409 },
	{ id: "staging", name: "Staging", scale: 0.06, salt: 811 },
];

interface DemoModel {
	id: string;
	provider: string;
	share: number;
	input: number;
	output: number;
	cacheShare: number;
	byokShare: number;
	inputPrice: number;
	outputPrice: number;
	cachedInputPrice: number;
}

const MODELS: DemoModel[] = [
	{
		id: "anthropic/claude-sonnet-5",
		provider: "anthropic",
		share: 0.24,
		input: 3400,
		output: 620,
		cacheShare: 0.45,
		byokShare: 0,
		inputPrice: 2.0e-6,
		outputPrice: 10.0e-6,
		cachedInputPrice: 0.2e-6,
	},
	{
		id: "google-vertex/gemini-3.8-flash",
		provider: "google-vertex",
		share: 0.2,
		input: 4200,
		output: 480,
		cacheShare: 0.35,
		byokShare: 0,
		inputPrice: 0.75e-6,
		outputPrice: 3.75e-6,
		cachedInputPrice: 0.075e-6,
	},
	{
		id: "openai/gpt-6-luna",
		provider: "openai",
		share: 0.18,
		input: 1500,
		output: 260,
		cacheShare: 0.2,
		byokShare: 0.55,
		inputPrice: 0.1e-6,
		outputPrice: 0.5e-6,
		cachedInputPrice: 0.01e-6,
	},
	{
		id: "openai/gpt-6-sol",
		provider: "openai",
		share: 0.14,
		input: 2800,
		output: 700,
		cacheShare: 0.3,
		byokShare: 0.55,
		inputPrice: 2.0e-6,
		outputPrice: 10.0e-6,
		cachedInputPrice: 0.2e-6,
	},
	{
		id: "deepseek/deepseek-v4.1-flash",
		provider: "deepseek",
		share: 0.12,
		input: 2100,
		output: 540,
		cacheShare: 0.5,
		byokShare: 0,
		inputPrice: 0.15e-6,
		outputPrice: 0.6e-6,
		cachedInputPrice: 0.003e-6,
	},
	{
		id: "fireworks/kimi-k3",
		provider: "fireworks",
		share: 0.06,
		input: 5200,
		output: 1150,
		cacheShare: 0.4,
		byokShare: 0,
		inputPrice: 3.0e-6,
		outputPrice: 15.0e-6,
		cachedInputPrice: 0.3e-6,
	},
	{
		id: "zai/glm-5.3",
		provider: "zai",
		share: 0.04,
		input: 3900,
		output: 900,
		cacheShare: 0.3,
		byokShare: 0,
		inputPrice: 1.4e-6,
		outputPrice: 4.4e-6,
		cachedInputPrice: 0.26e-6,
	},
	{
		id: "aws-bedrock/claude-sonnet-5",
		provider: "aws-bedrock",
		share: 0.02,
		input: 3400,
		output: 620,
		cacheShare: 0.45,
		byokShare: 0,
		inputPrice: 2.0e-6,
		outputPrice: 10.0e-6,
		cachedInputPrice: 0.2e-6,
	},
];

export const PROVIDER_NAMES: Record<string, string> = {
	anthropic: "Anthropic",
	"google-vertex": "Google Vertex AI",
	openai: "OpenAI",
	deepseek: "DeepSeek",
	fireworks: "Fireworks AI",
	zai: "Z AI",
	"aws-bedrock": "AWS Bedrock",
	azure: "Azure",
	"azure-anthropic": "Azure Anthropic",
	"vertex-anthropic": "Vertex AI (Anthropic)",
	"google-ai-studio": "Google AI Studio",
	deepinfra: "DeepInfra",
	"together-ai": "Together AI",
	novita: "NovitaAI",
	moonshot: "Moonshot AI",
};

export const DEMO_MODELS = [
	{
		id: "claude-sonnet-5",
		name: "Claude Sonnet 5",
		providers: [
			"anthropic",
			"aws-bedrock",
			"azure-anthropic",
			"vertex-anthropic",
		],
	},
	{
		id: "deepseek-v4.1-flash",
		name: "DeepSeek V4.1 Flash",
		providers: ["deepseek", "deepinfra", "fireworks", "together-ai", "novita"],
	},
	{
		id: "gemini-3.8-flash",
		name: "Gemini 3.8 Flash",
		providers: ["google-ai-studio", "google-vertex"],
	},
	{ id: "glm-5.3", name: "GLM-5.3", providers: ["zai", "fireworks", "novita"] },
	{ id: "gpt-6-luna", name: "GPT-6 Luna", providers: ["openai", "azure"] },
	{ id: "gpt-6-sol", name: "GPT-6 Sol", providers: ["openai", "azure"] },
	{
		id: "kimi-k3",
		name: "Kimi K3",
		providers: ["moonshot", "fireworks", "together-ai", "novita"],
	},
];

export interface DemoApiKey {
	id: string;
	description: string;
	share: number;
	ownerId: string;
}

export const DEMO_API_KEYS: DemoApiKey[] = [
	{
		id: "key_coding",
		description: "coding-agents",
		share: 0.31,
		ownerId: "usr_leo",
	},
	{
		id: "key_support",
		description: "support-bot",
		share: 0.26,
		ownerId: "usr_sam",
	},
	{
		id: "key_pipeline",
		description: "data-pipeline",
		share: 0.18,
		ownerId: "usr_priya",
	},
	{
		id: "key_search",
		description: "search-summaries",
		share: 0.17,
		ownerId: "usr_sam",
	},
	{
		id: "key_legal",
		description: "legal-review",
		share: 0.08,
		ownerId: "usr_maya",
	},
];

const USER_SHARES = [
	{ id: "usr_leo", name: "Leo Martin", share: 0.31 },
	{ id: "usr_sam", name: "Sam Okafor", share: 0.43 },
	{ id: "usr_priya", name: "Priya Shah", share: 0.18 },
	{ id: "usr_maya", name: "Maya Patel", share: 0.08 },
];

function random(seed: number, salt = 0) {
	let t = (seed + Math.imul(salt, 0x9e3779b1) + 0x6d2b79f5) | 0;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function lerp(base: number, spread: number, factor: number) {
	const offset = spread * factor;
	return base + offset;
}

function vary(base: number, spread: number, seed: number, salt = 0) {
	return lerp(base, spread, random(seed, salt));
}

function round(value: number, digits = 6) {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function splitUsage<T extends { share: number }>(
	items: T[],
	totals: {
		requestCount: number;
		inputTokens: number;
		outputTokens: number;
		cost: number;
		creditsCost: number;
		apiKeysCost: number;
		creditsRequestCount: number;
		apiKeysRequestCount: number;
	},
) {
	return items.map((item) => ({
		item,
		requestCount: Math.round(totals.requestCount * item.share),
		inputTokens: Math.round(totals.inputTokens * item.share),
		outputTokens: Math.round(totals.outputTokens * item.share),
		totalTokens: Math.round(
			(totals.inputTokens + totals.outputTokens) * item.share,
		),
		cost: round(totals.cost * item.share),
		creditsCost: round(totals.creditsCost * item.share),
		apiKeysCost: round(totals.apiKeysCost * item.share),
		creditsRequestCount: Math.round(totals.creditsRequestCount * item.share),
		apiKeysRequestCount: Math.round(totals.apiKeysRequestCount * item.share),
	}));
}

function buildBucket(
	date: string,
	requests: number,
	seed: number,
	errorSpike: boolean,
): DailyActivity {
	const modelBreakdown: ActivityModelUsage[] = MODELS.map((model, index) => {
		const jitter = vary(0.85, 0.3, seed * 31, index);
		const requestCount = Math.max(
			0,
			Math.round(requests * model.share * jitter),
		);
		const inputTokens = Math.round(
			requestCount * model.input * vary(0.9, 0.2, seed * 17, index),
		);
		const outputTokens = Math.round(
			requestCount * model.output * vary(0.9, 0.2, seed * 19, index),
		);
		const cachedTokens = Math.round(inputTokens * model.cacheShare);
		const cacheWriteTokens =
			model.provider === "anthropic" || model.provider === "aws-bedrock"
				? Math.round(inputTokens * 0.04)
				: 0;
		const uncachedCost = (inputTokens - cachedTokens) * model.inputPrice;
		const cachedCost = cachedTokens * model.cachedInputPrice;
		const completionCost = outputTokens * model.outputPrice;
		const cost = uncachedCost + cachedCost + completionCost;
		const apiKeysRequestCount = Math.round(requestCount * model.byokShare);
		return {
			id: model.id,
			provider: model.provider,
			requestCount,
			inputTokens,
			outputTokens,
			cachedTokens,
			cacheWriteTokens,
			totalTokens: inputTokens + outputTokens,
			cost: round(cost),
			creditsRequestCount: requestCount - apiKeysRequestCount,
			apiKeysRequestCount,
			creditsCost: round(cost * (1 - model.byokShare)),
			apiKeysCost: round(cost * model.byokShare),
		};
	});

	const sum = (pick: (row: ActivityModelUsage) => number) =>
		modelBreakdown.reduce((total, row) => total + pick(row), 0);

	const requestCount = sum((row) => row.requestCount);
	const inputTokens = sum((row) => row.inputTokens);
	const outputTokens = sum((row) => row.outputTokens);
	const cachedTokens = sum((row) => row.cachedTokens);
	const cacheWriteTokens = sum((row) => row.cacheWriteTokens);
	const cost = round(sum((row) => row.cost));
	const creditsCost = round(sum((row) => row.creditsCost));
	const apiKeysCost = round(sum((row) => row.apiKeysCost));
	const creditsRequestCount = sum((row) => row.creditsRequestCount);
	const apiKeysRequestCount = sum((row) => row.apiKeysRequestCount);

	let inputCost = 0;
	let outputCost = 0;
	let cachedInputCost = 0;
	modelBreakdown.forEach((row, index) => {
		const model = MODELS[index];
		inputCost += (row.inputTokens - row.cachedTokens) * model.inputPrice;
		cachedInputCost += row.cachedTokens * model.cachedInputPrice;
		outputCost += row.outputTokens * model.outputPrice;
	});

	const errorRate = errorSpike
		? vary(0.021, 0.004, seed * 3)
		: vary(0.0022, 0.0045, seed * 5);
	const clientErrorCount = Math.round(
		requestCount * vary(0.005, 0.003, seed * 11),
	);
	const errorCount = Math.round(requestCount * errorRate);
	const cacheCount = Math.round(requestCount * vary(0.16, 0.04, seed * 13));
	const dataStorageCost = round(
		((inputTokens + outputTokens) / 1_000_000) * 0.01,
	);

	const totals = {
		requestCount,
		inputTokens,
		outputTokens,
		cost,
		creditsCost,
		apiKeysCost,
		creditsRequestCount,
		apiKeysRequestCount,
	};

	const apiKeyBreakdown: ActivityApiKeyUsage[] = splitUsage(
		DEMO_API_KEYS,
		totals,
	).map(({ item, ...usage }) => ({
		id: item.id,
		description: item.description,
		...usage,
	}));

	const userBreakdown: ActivityUserUsage[] = splitUsage(
		USER_SHARES,
		totals,
	).map(({ item, ...usage }) => ({
		id: item.id,
		name: item.name,
		...usage,
	}));

	return {
		date,
		requestCount,
		inputTokens,
		outputTokens,
		cachedTokens,
		cacheWriteTokens,
		totalTokens: inputTokens + outputTokens,
		cost,
		outputCost: round(outputCost),
		inputCost: round(inputCost),
		requestCost: 0,
		dataStorageCost,
		imageInputCost: 0,
		audioInputCost: 0,
		audioOutputCost: 0,
		imageOutputCost: 0,
		videoOutputCost: 0,
		cachedInputCost: round(cachedInputCost),
		cacheWriteInputCost: 0,
		errorCount,
		clientErrorCount,
		errorRate:
			requestCount - clientErrorCount > 0
				? (errorCount / (requestCount - clientErrorCount)) * 100
				: 0,
		cacheCount,
		cacheRate: requestCount > 0 ? (cacheCount / requestCount) * 100 : 0,
		discountSavings: round(cost * 0.034),
		creditsRequestCount,
		apiKeysRequestCount,
		creditsCost,
		apiKeysCost,
		creditsDataStorageCost: dataStorageCost,
		apiKeysDataStorageCost: 0,
		modelBreakdown,
		apiKeyBreakdown,
		userBreakdown,
	};
}

export function buildDailyActivity(
	anchorDay: string,
	project: DemoProject,
): DailyActivity[] {
	const anchor = parseISO(anchorDay);
	return Array.from({ length: HISTORY_DAYS }, (_, index) => {
		const date = subDays(anchor, HISTORY_DAYS - 1 - index);
		const weekday = date.getDay();
		const weekend = weekday === 0 || weekday === 6 ? 0.58 : 1;
		const growth = lerp(0.55, 0.55, index / HISTORY_DAYS);
		const noise = vary(0.9, 0.2, index * 101, project.salt);
		const requests = 46_000 * project.scale * weekend * growth * noise;
		return buildBucket(
			format(date, "yyyy-MM-dd"),
			requests,
			index + project.salt,
			index === HISTORY_DAYS - 4,
		);
	});
}

export function sliceHistory(
	history: DailyActivity[],
	from: Date,
	to: Date,
): DailyActivity[] {
	const start = format(from, "yyyy-MM-dd");
	const end = format(to, "yyyy-MM-dd");
	return history.filter((day) => day.date >= start && day.date <= end);
}

export function buildHourlyActivity(
	endHour: Date,
	hours: number,
	project: DemoProject,
): DailyActivity[] {
	return Array.from({ length: hours + 1 }, (_, index) => {
		const date = addHours(endHour, index - hours);
		const hour = date.getHours();
		const curve = lerp(
			0.45,
			0.55,
			Math.sin(((hour - 5) / 24) * Math.PI * 2) ** 2,
		);
		const requests =
			2_150 * project.scale * curve * vary(0.8, 0.4, hour * 53, project.salt);
		return buildBucket(
			format(date, "yyyy-MM-dd'T'HH:00:00"),
			requests,
			hour + 7_000 + project.salt,
			false,
		);
	});
}

export type LogFinishReason =
	| "completed"
	| "tool_calls"
	| "client_error"
	| "upstream_error"
	| "content_filter";

export interface DemoProviderScore {
	providerId: string;
	score: number;
	uptime: number;
	latency: number;
	price: number;
	failed?: boolean;
	statusCode?: number;
	errorType?: string;
}

export interface DemoRoutingAttempt {
	provider: string;
	model: string;
	succeeded: boolean;
	statusCode: number;
	errorType?: string;
}

export interface DemoLog {
	id: string;
	agoSeconds: number;
	content: string | null;
	unifiedFinishReason: LogFinishReason;
	finishReason: string;
	hasError: boolean;
	requestedModel: string;
	usedModel: string;
	usedProvider: string;
	usedMode: "credits" | "api-keys";
	cached: boolean;
	promptTokens: number;
	completionTokens: number;
	cachedTokens: number;
	duration: number;
	timeToFirstToken: number | null;
	streamed: boolean;
	cost: number;
	inputCost: number;
	outputCost: number;
	cachedInputCost: number;
	source: string;
	apiKeyId: string;
	apiKeyName: string;
	errorCategory?: string;
	errorDetails?: {
		statusCode: number;
		statusText: string;
		responseText: string;
	};
	noFallback?: boolean;
	selectionReason?: string;
	availableProviders?: string[];
	providerScores?: DemoProviderScore[];
	routing?: DemoRoutingAttempt[];
}

export const DEMO_LOGS: DemoLog[] = [
	{
		id: "log_8f2k1qzt",
		agoSeconds: 4,
		content:
			"Thanks for reaching out. I've reset the SSO link for your workspace, so you can sign in again from the login page.",
		unifiedFinishReason: "completed",
		finishReason: "end_turn",
		hasError: false,
		requestedModel: "claude-sonnet-5",
		usedModel: "aws-bedrock/claude-sonnet-5",
		usedProvider: "aws-bedrock",
		usedMode: "credits",
		cached: false,
		promptTokens: 1842,
		completionTokens: 512,
		cachedTokens: 0,
		duration: 2140,
		timeToFirstToken: 610,
		streamed: true,
		cost: 0.008804,
		inputCost: 0.003684,
		outputCost: 0.00512,
		cachedInputCost: 0,
		source: "support-bot",
		apiKeyId: "key_support",
		apiKeyName: "support-bot",
		selectionReason: "weighted-score",
		availableProviders: [
			"anthropic",
			"aws-bedrock",
			"vertex-anthropic",
			"azure-anthropic",
		],
		providerScores: [
			{
				providerId: "anthropic",
				score: 0.18,
				uptime: 99,
				latency: 540,
				price: 2,
				failed: true,
				statusCode: 503,
				errorType: "upstream_error",
			},
			{
				providerId: "aws-bedrock",
				score: 0.24,
				uptime: 100,
				latency: 610,
				price: 2,
			},
			{
				providerId: "vertex-anthropic",
				score: 0.31,
				uptime: 99,
				latency: 690,
				price: 2,
			},
		],
		routing: [
			{
				provider: "anthropic",
				model: "claude-sonnet-5",
				succeeded: false,
				statusCode: 503,
				errorType: "upstream_error",
			},
			{
				provider: "aws-bedrock",
				model: "claude-sonnet-5",
				succeeded: true,
				statusCode: 200,
			},
		],
	},
	{
		id: "log_7d3m9xpa",
		agoSeconds: 11,
		content: null,
		unifiedFinishReason: "tool_calls",
		finishReason: "tool_calls",
		hasError: false,
		requestedModel: "gpt-6-sol",
		usedModel: "openai/gpt-6-sol",
		usedProvider: "openai",
		usedMode: "api-keys",
		cached: false,
		promptTokens: 6120,
		completionTokens: 402,
		cachedTokens: 2944,
		duration: 3410,
		timeToFirstToken: 820,
		streamed: true,
		cost: 0.010961,
		inputCost: 0.006352,
		outputCost: 0.00402,
		cachedInputCost: 0.000589,
		source: "coding-agents",
		apiKeyId: "key_coding",
		apiKeyName: "coding-agents",
		selectionReason: "weighted-score",
		availableProviders: ["openai", "azure"],
		providerScores: [
			{
				providerId: "openai",
				score: 0.16,
				uptime: 100,
				latency: 480,
				price: 2,
			},
			{
				providerId: "azure",
				score: 0.27,
				uptime: 99,
				latency: 620,
				price: 2,
			},
		],
		routing: [
			{
				provider: "openai",
				model: "gpt-6-sol",
				succeeded: true,
				statusCode: 200,
			},
		],
	},
	{
		id: "log_6c1p4zmb",
		agoSeconds: 17,
		content:
			"Summary: the renewal adds two seats, keeps the 12-month term and moves invoicing to net 30.",
		unifiedFinishReason: "completed",
		finishReason: "stop",
		hasError: false,
		requestedModel: "gemini-3.8-flash",
		usedModel: "google-vertex/gemini-3.8-flash",
		usedProvider: "google-vertex",
		usedMode: "credits",
		cached: true,
		promptTokens: 12406,
		completionTokens: 1204,
		cachedTokens: 0,
		duration: 41,
		timeToFirstToken: null,
		streamed: false,
		cost: 0,
		inputCost: 0,
		outputCost: 0,
		cachedInputCost: 0,
		source: "search-summaries",
		apiKeyId: "key_search",
		apiKeyName: "search-summaries",
	},
	{
		id: "log_5b8n2wqe",
		agoSeconds: 26,
		content:
			"Refactored the retry helper into its own module and added tests for the timeout path.",
		unifiedFinishReason: "completed",
		finishReason: "stop",
		hasError: false,
		requestedModel: "kimi-k3",
		usedModel: "fireworks/kimi-k3",
		usedProvider: "fireworks",
		usedMode: "credits",
		cached: false,
		promptTokens: 6120,
		completionTokens: 1402,
		cachedTokens: 2400,
		duration: 4880,
		timeToFirstToken: 930,
		streamed: true,
		cost: 0.03201,
		inputCost: 0.01116,
		outputCost: 0.02103,
		cachedInputCost: 0.00072,
		source: "coding-agents",
		apiKeyId: "key_coding",
		apiKeyName: "coding-agents",
		selectionReason: "weighted-score",
		availableProviders: [
			"moonshot",
			"fireworks",
			"together-ai",
			"novita",
			"alibaba",
		],
		providerScores: [
			{
				providerId: "fireworks",
				score: 0.21,
				uptime: 100,
				latency: 710,
				price: 3,
			},
			{
				providerId: "moonshot",
				score: 0.26,
				uptime: 99,
				latency: 880,
				price: 3,
			},
			{
				providerId: "together-ai",
				score: 0.33,
				uptime: 98,
				latency: 940,
				price: 3,
			},
		],
		routing: [
			{
				provider: "fireworks",
				model: "kimi-k3",
				succeeded: true,
				statusCode: 200,
			},
		],
	},
	{
		id: "log_4a6v7rkc",
		agoSeconds: 38,
		content: null,
		unifiedFinishReason: "client_error",
		finishReason: "client_error",
		hasError: true,
		requestedModel: "claude-sonnet-5",
		usedModel: "",
		usedProvider: "llmgateway",
		usedMode: "credits",
		cached: false,
		promptTokens: 0,
		completionTokens: 0,
		cachedTokens: 0,
		duration: 0,
		timeToFirstToken: null,
		streamed: false,
		cost: 0,
		inputCost: 0,
		outputCost: 0,
		cachedInputCost: 0,
		source: "support-bot",
		apiKeyId: "key_support",
		apiKeyName: "support-bot",
		errorCategory: "guardrail",
		errorDetails: {
			statusCode: 400,
			statusText: "Bad Request",
			responseText:
				'{"message":"Request blocked by content policy: Secrets Detection (rule system:secrets, category secrets)","violations":[{"rule_id":"system:secrets","rule_name":"Secrets Detection","category":"secrets","action":"block"}]}',
		},
	},
	{
		id: "log_3z5t8kvd",
		agoSeconds: 52,
		content:
			"Clause 7.2 caps liability at fees paid in the prior 12 months. No indemnity for data loss.",
		unifiedFinishReason: "completed",
		finishReason: "stop",
		hasError: false,
		requestedModel: "gpt-6-sol",
		usedModel: "openai/gpt-6-sol",
		usedProvider: "openai",
		usedMode: "api-keys",
		cached: false,
		promptTokens: 3210,
		completionTokens: 894,
		cachedTokens: 0,
		duration: 3120,
		timeToFirstToken: 740,
		streamed: true,
		cost: 0.01536,
		inputCost: 0.00642,
		outputCost: 0.00894,
		cachedInputCost: 0,
		source: "legal-review",
		apiKeyId: "key_legal",
		apiKeyName: "legal-review",
		selectionReason: "weighted-score",
		availableProviders: ["openai", "azure"],
		providerScores: [
			{
				providerId: "openai",
				score: 0.17,
				uptime: 100,
				latency: 470,
				price: 2,
			},
			{
				providerId: "azure",
				score: 0.28,
				uptime: 99,
				latency: 650,
				price: 2,
			},
		],
		routing: [
			{
				provider: "openai",
				model: "gpt-6-sol",
				succeeded: true,
				statusCode: 200,
			},
		],
	},
	{
		id: "log_2y4s6jfw",
		agoSeconds: 71,
		content:
			"Extracted 42 line items. Totals match the invoice header; two SKUs are missing a tax code.",
		unifiedFinishReason: "completed",
		finishReason: "stop",
		hasError: false,
		requestedModel: "deepseek-v4.1-flash",
		usedModel: "deepseek/deepseek-v4.1-flash",
		usedProvider: "deepseek",
		usedMode: "credits",
		cached: false,
		promptTokens: 2048,
		completionTokens: 640,
		cachedTokens: 1024,
		duration: 1220,
		timeToFirstToken: 390,
		streamed: false,
		cost: 0.000541,
		inputCost: 0.000154,
		outputCost: 0.000384,
		cachedInputCost: 0.000003,
		source: "data-pipeline",
		apiKeyId: "key_pipeline",
		apiKeyName: "data-pipeline",
		selectionReason: "weighted-score",
		availableProviders: [
			"deepseek",
			"deepinfra",
			"fireworks",
			"together-ai",
			"novita",
		],
		providerScores: [
			{
				providerId: "deepseek",
				score: 0.12,
				uptime: 100,
				latency: 420,
				price: 0.15,
			},
			{
				providerId: "deepinfra",
				score: 0.19,
				uptime: 99,
				latency: 510,
				price: 0.2,
			},
			{
				providerId: "fireworks",
				score: 0.22,
				uptime: 100,
				latency: 470,
				price: 0.22,
			},
		],
		routing: [
			{
				provider: "deepseek",
				model: "deepseek-v4.1-flash",
				succeeded: true,
				statusCode: 200,
			},
		],
	},
	{
		id: "log_1x3r5hgn",
		agoSeconds: 96,
		content:
			"The migration plan keeps the old table readable until every service reads from the new one.",
		unifiedFinishReason: "completed",
		finishReason: "stop",
		hasError: false,
		requestedModel: "glm-5.3",
		usedModel: "zai/glm-5.3",
		usedProvider: "zai",
		usedMode: "credits",
		cached: false,
		promptTokens: 4512,
		completionTokens: 1136,
		cachedTokens: 0,
		duration: 2960,
		timeToFirstToken: 700,
		streamed: true,
		cost: 0.011315,
		inputCost: 0.006317,
		outputCost: 0.004998,
		cachedInputCost: 0,
		source: "coding-agents",
		apiKeyId: "key_coding",
		apiKeyName: "coding-agents",
		selectionReason: "weighted-score",
		availableProviders: [
			"zai",
			"fireworks",
			"novita",
			"together-ai",
			"inference.net",
		],
		providerScores: [
			{
				providerId: "fireworks",
				score: 0.2,
				uptime: 97,
				latency: 690,
				price: 1.4,
				failed: true,
				statusCode: 504,
				errorType: "upstream_error",
			},
			{
				providerId: "zai",
				score: 0.23,
				uptime: 99,
				latency: 760,
				price: 1.4,
			},
			{
				providerId: "novita",
				score: 0.29,
				uptime: 99,
				latency: 820,
				price: 1.4,
			},
		],
		routing: [
			{
				provider: "fireworks",
				model: "glm-5.3",
				succeeded: false,
				statusCode: 504,
				errorType: "upstream_error",
			},
			{
				provider: "zai",
				model: "glm-5.3",
				succeeded: true,
				statusCode: 200,
			},
		],
	},
	{
		id: "log_0w2q4fds",
		agoSeconds: 133,
		content:
			"Category: billing. Priority: normal. Suggested reply drafted from the refund policy article.",
		unifiedFinishReason: "completed",
		finishReason: "stop",
		hasError: false,
		requestedModel: "gpt-6-luna",
		usedModel: "openai/gpt-6-luna",
		usedProvider: "openai",
		usedMode: "api-keys",
		cached: false,
		promptTokens: 1520,
		completionTokens: 240,
		cachedTokens: 512,
		duration: 690,
		timeToFirstToken: 210,
		streamed: false,
		cost: 0.000226,
		inputCost: 0.000101,
		outputCost: 0.00012,
		cachedInputCost: 0.000005,
		source: "support-bot",
		apiKeyId: "key_support",
		apiKeyName: "support-bot",
		selectionReason: "weighted-score",
		availableProviders: ["openai", "azure"],
		providerScores: [
			{
				providerId: "openai",
				score: 0.14,
				uptime: 100,
				latency: 260,
				price: 0.1,
			},
			{
				providerId: "azure",
				score: 0.25,
				uptime: 99,
				latency: 330,
				price: 0.1,
			},
		],
		routing: [
			{
				provider: "openai",
				model: "gpt-6-luna",
				succeeded: true,
				statusCode: 200,
			},
		],
	},
	{
		id: "log_9v1p3ebc",
		agoSeconds: 184,
		content: null,
		unifiedFinishReason: "upstream_error",
		finishReason: "upstream_error",
		hasError: true,
		requestedModel: "google-vertex/gemini-3.8-flash",
		usedModel: "google-vertex/gemini-3.8-flash",
		usedProvider: "google-vertex",
		usedMode: "credits",
		cached: false,
		promptTokens: 0,
		completionTokens: 0,
		cachedTokens: 0,
		duration: 30010,
		timeToFirstToken: null,
		streamed: true,
		cost: 0,
		inputCost: 0,
		outputCost: 0,
		cachedInputCost: 0,
		source: "search-summaries",
		apiKeyId: "key_search",
		apiKeyName: "search-summaries",
		errorCategory: "upstream",
		errorDetails: {
			statusCode: 504,
			statusText: "Gateway Timeout",
			responseText:
				'{"error":{"code":504,"message":"Deadline expired before operation could complete.","status":"DEADLINE_EXCEEDED"}}',
		},
		noFallback: true,
		selectionReason: "direct-provider-specified",
		availableProviders: ["google-vertex"],
		routing: [
			{
				provider: "google-vertex",
				model: "gemini-3.8-flash",
				succeeded: false,
				statusCode: 504,
				errorType: "upstream_error",
			},
		],
	},
];

export type GuardrailAction = "block" | "redact" | "warn" | "allow";

export const SYSTEM_RULES = [
	{
		id: "prompt_injection",
		name: "Prompt Injection Detection",
		description:
			"Detect attempts to override system instructions or inject malicious prompts",
	},
	{
		id: "jailbreak",
		name: "Jailbreak Prevention",
		description: "Block attempts to bypass AI safety measures",
	},
	{
		id: "pii_detection",
		name: "PII Detection",
		description:
			"Detect and optionally redact personally identifiable information",
	},
	{
		id: "secrets",
		name: "Secrets Detection",
		description: "Detect API keys, passwords, and other credentials",
	},
	{
		id: "file_types",
		name: "File Type Restrictions",
		description: "Restrict uploads to allowed file types",
	},
	{
		id: "document_leakage",
		name: "Document Leakage Prevention",
		description: "Prevent exposure of confidential document content",
	},
] as const;

export type SystemRuleId = (typeof SYSTEM_RULES)[number]["id"];

export const DEFAULT_SYSTEM_RULES: Record<
	SystemRuleId,
	{ enabled: boolean; action: GuardrailAction }
> = {
	prompt_injection: { enabled: true, action: "block" },
	jailbreak: { enabled: true, action: "block" },
	pii_detection: { enabled: true, action: "redact" },
	secrets: { enabled: true, action: "block" },
	file_types: { enabled: true, action: "block" },
	document_leakage: { enabled: false, action: "warn" },
};

export const ALLOWED_FILE_TYPES = ["pdf", "txt", "md", "csv", "json", "xml"];

export interface DemoCustomRule {
	id: string;
	name: string;
	type: "blocked_terms" | "custom_regex" | "topic_restriction";
	action: GuardrailAction;
	enabled: boolean;
}

export const CUSTOM_RULES: DemoCustomRule[] = [
	{
		id: "rule_competitors",
		name: "Competitor mentions",
		type: "blocked_terms",
		action: "warn",
		enabled: true,
	},
	{
		id: "rule_codenames",
		name: "Internal project codenames",
		type: "custom_regex",
		action: "redact",
		enabled: true,
	},
	{
		id: "rule_medical",
		name: "Medical advice",
		type: "topic_restriction",
		action: "block",
		enabled: false,
	},
];

export interface DemoViolation {
	id: string;
	agoMinutes: number;
	ruleName: string;
	category: string;
	actionTaken: "blocked" | "redacted" | "warned";
	matchedPattern: string | null;
}

export const VIOLATIONS: DemoViolation[] = [
	{
		id: "gv_1",
		agoMinutes: 1,
		ruleName: "Secrets Detection",
		category: "secrets",
		actionTaken: "blocked",
		matchedPattern: "aws_access_key_id",
	},
	{
		id: "gv_2",
		agoMinutes: 6,
		ruleName: "PII Detection",
		category: "pii",
		actionTaken: "redacted",
		matchedPattern: "email",
	},
	{
		id: "gv_3",
		agoMinutes: 19,
		ruleName: "Prompt Injection Detection",
		category: "injection",
		actionTaken: "blocked",
		matchedPattern: null,
	},
	{
		id: "gv_4",
		agoMinutes: 47,
		ruleName: "Internal project codenames",
		category: "custom_regex",
		actionTaken: "redacted",
		matchedPattern: null,
	},
	{
		id: "gv_5",
		agoMinutes: 92,
		ruleName: "PII Detection",
		category: "pii",
		actionTaken: "redacted",
		matchedPattern: "phone",
	},
	{
		id: "gv_6",
		agoMinutes: 160,
		ruleName: "Competitor mentions",
		category: "blocked_terms",
		actionTaken: "warned",
		matchedPattern: null,
	},
	{
		id: "gv_7",
		agoMinutes: 310,
		ruleName: "Jailbreak Prevention",
		category: "jailbreak",
		actionTaken: "blocked",
		matchedPattern: null,
	},
	{
		id: "gv_8",
		agoMinutes: 540,
		ruleName: "PII Detection",
		category: "pii",
		actionTaken: "redacted",
		matchedPattern: "credit_card",
	},
];

export const VIOLATION_STATS: Record<
	"7" | "30" | "90",
	{ total: number; last24Hours: number; blocked: number; redacted: number }
> = {
	"7": { total: 184, last24Hours: 23, blocked: 61, redacted: 97 },
	"30": { total: 702, last24Hours: 23, blocked: 238, redacted: 371 },
	"90": { total: 1986, last24Hours: 23, blocked: 671, redacted: 1054 },
};

export interface DemoAuditLog {
	id: string;
	agoMinutes: number;
	actor: { name: string; email: string } | "system";
	action: string;
	resourceType: string;
	resourceId: string | null;
	resourceName: string | null;
}

const MAYA = { name: "Maya Patel", email: "maya@acme.com" };
const SAM = { name: "Sam Okafor", email: "sam@acme.com" };
const PRIYA = { name: "Priya Shah", email: "priya@acme.com" };

export const AUDIT_LOGS: DemoAuditLog[] = [
	{
		id: "al_1",
		agoMinutes: 4,
		actor: MAYA,
		action: "api_key.update_limit",
		resourceType: "api_key",
		resourceId: "k7Qm2xV9pL",
		resourceName: "support-bot",
	},
	{
		id: "al_2",
		agoMinutes: 18,
		actor: "system",
		action: "scim.user.provision",
		resourceType: "scim_user",
		resourceId: "u3Fh8sK1wR",
		resourceName: "ana@acme.com",
	},
	{
		id: "al_3",
		agoMinutes: 22,
		actor: SAM,
		action: "team_member.invite",
		resourceType: "team_invite",
		resourceId: "i9Tb4nM6cZ",
		resourceName: "noah@acme.com",
	},
	{
		id: "al_4",
		agoMinutes: 61,
		actor: MAYA,
		action: "organization_team.budget_update",
		resourceType: "organization_team",
		resourceId: "t2Lp7dQ3vX",
		resourceName: "Research",
	},
	{
		id: "al_5",
		agoMinutes: 95,
		actor: MAYA,
		action: "sso.sign_in",
		resourceType: "sso_session",
		resourceId: null,
		resourceName: "acme-okta",
	},
	{
		id: "al_6",
		agoMinutes: 180,
		actor: PRIYA,
		action: "api_key.roll",
		resourceType: "api_key",
		resourceId: "k4Wn8rT2hJ",
		resourceName: "data-pipeline",
	},
	{
		id: "al_7",
		agoMinutes: 290,
		actor: SAM,
		action: "team_member.budget_update",
		resourceType: "team_member",
		resourceId: "m6Yc1gP5sD",
		resourceName: "leo@acme.com",
	},
	{
		id: "al_8",
		agoMinutes: 420,
		actor: MAYA,
		action: "provider_key.create",
		resourceType: "provider_key",
		resourceId: "p8Rz3kF7nB",
		resourceName: "OpenAI",
	},
	{
		id: "al_9",
		agoMinutes: 1_380,
		actor: MAYA,
		action: "sso_role_mapping.create",
		resourceType: "sso_role_mapping",
		resourceId: "r1Vx6jH9qM",
		resourceName: "Platform Admins",
	},
	{
		id: "al_10",
		agoMinutes: 1_720,
		actor: SAM,
		action: "api_key.delete",
		resourceType: "api_key",
		resourceId: "k0Gs5wE3yN",
		resourceName: "old-prototype",
	},
	{
		id: "al_11",
		agoMinutes: 2_950,
		actor: PRIYA,
		action: "project.create",
		resourceType: "project",
		resourceId: "j5Ud2mA8tC",
		resourceName: "Internal Tools",
	},
	{
		id: "al_12",
		agoMinutes: 4_310,
		actor: MAYA,
		action: "payment.credit_topup",
		resourceType: "payment",
		resourceId: "y7Kq4bL1xF",
		resourceName: null,
	},
];

export type MemberRole = "owner" | "admin" | "project_admin" | "developer";

export interface DemoBudget {
	usageLimit: number | null;
	periodUsageLimit: number | null;
	periodUsageDurationValue: number | null;
	periodUsageDurationUnit: "hour" | "day" | "week" | "month" | null;
	maxApiKeys: number | null;
}

export interface DemoMember {
	id: string;
	userId: string;
	name: string;
	email: string;
	role: MemberRole;
	team: string | null;
	projects: string[] | null;
	budget: DemoBudget | null;
	teamBudget: DemoBudget | null;
}

const RESEARCH_BUDGET: DemoBudget = {
	usageLimit: null,
	periodUsageLimit: 5000,
	periodUsageDurationValue: 1,
	periodUsageDurationUnit: "month",
	maxApiKeys: null,
};

const SUPPORT_BUDGET: DemoBudget = {
	usageLimit: null,
	periodUsageLimit: 2000,
	periodUsageDurationValue: 1,
	periodUsageDurationUnit: "month",
	maxApiKeys: 5,
};

export const DEFAULT_DEVELOPER_BUDGET: DemoBudget = {
	usageLimit: null,
	periodUsageLimit: 100,
	periodUsageDurationValue: 1,
	periodUsageDurationUnit: "day",
	maxApiKeys: 5,
};

export const DEMO_MEMBERS: DemoMember[] = [
	{
		id: "mem_maya",
		userId: "usr_maya",
		name: "Maya Patel",
		email: "maya@acme.com",
		role: "owner",
		team: null,
		projects: null,
		budget: null,
		teamBudget: null,
	},
	{
		id: "mem_sam",
		userId: "usr_sam",
		name: "Sam Okafor",
		email: "sam@acme.com",
		role: "admin",
		team: null,
		projects: null,
		budget: null,
		teamBudget: null,
	},
	{
		id: "mem_priya",
		userId: "usr_priya",
		name: "Priya Shah",
		email: "priya@acme.com",
		role: "project_admin",
		team: null,
		projects: ["Production API", "Internal Tools"],
		budget: null,
		teamBudget: null,
	},
	{
		id: "mem_leo",
		userId: "usr_leo",
		name: "Leo Martin",
		email: "leo@acme.com",
		role: "developer",
		team: "Support",
		projects: ["Production API"],
		budget: {
			usageLimit: 500,
			periodUsageLimit: 50,
			periodUsageDurationValue: 1,
			periodUsageDurationUnit: "day",
			maxApiKeys: 3,
		},
		teamBudget: SUPPORT_BUDGET,
	},
	{
		id: "mem_ana",
		userId: "usr_ana",
		name: "Ana Ruiz",
		email: "ana@acme.com",
		role: "developer",
		team: "Research",
		projects: ["Production API", "Internal Tools"],
		budget: DEFAULT_DEVELOPER_BUDGET,
		teamBudget: RESEARCH_BUDGET,
	},
];

export const SEAT_LIMIT = 100;

export const DEMO_TEAMS = [
	{
		id: "team_support",
		name: "Support",
		members: 1,
		projects: ["Production API"],
		iamRules: 2,
	},
	{
		id: "team_research",
		name: "Research",
		members: 1,
		projects: ["Production API", "Internal Tools"],
		iamRules: 1,
	},
	{
		id: "team_growth",
		name: "Growth",
		members: 0,
		projects: ["Internal Tools"],
		iamRules: 0,
	},
];

export const SSO_CONNECTION = {
	providerId: "acme-okta",
	providerType: "okta" as const,
	domains: ["acme.com", "acme-labs.com"],
	enforced: true,
};

export const SSO_ROLE_MAPPINGS = [
	{ id: "rm_1", groupName: "Platform Admins", role: "admin" },
	{ id: "rm_2", groupName: "Team Leads", role: "project_admin" },
	{ id: "rm_3", groupName: "Engineering", role: "developer" },
];

export const SSO_TEAM_MAPPINGS = [
	{ id: "tm_1", groupName: "Support Engineering", teamName: "Support" },
	{ id: "tm_2", groupName: "ML Research", teamName: "Research" },
];

export const ANNOUNCEMENTS: {
	slug: string;
	title: string;
	summary: string;
	date: string;
	type: "changelog" | "blog";
}[] = [
	{
		slug: "azure-priority-processing",
		title: "Azure Priority Processing",
		summary:
			"Request Azure's low-latency Priority tier with the same service_tier field you already use for OpenAI.",
		date: "2026-09-26",
		type: "changelog",
	},
	{
		slug: "smart-routing",
		title: "Smart Routing",
		summary:
			"A new smart model string: choose which models it may resolve to, and let a classifier rate each request.",
		date: "2026-09-25",
		type: "changelog",
	},
	{
		slug: "compliance-alerts",
		title: "Compliance Alerts",
		summary:
			"Watch models your compliance policy blocks today and get told when a provider that meets it goes live.",
		date: "2026-09-23",
		type: "changelog",
	},
	{
		slug: "gpt-6-sol-luna",
		title: "GPT-6 Sol & Luna at Half the Price",
		summary:
			"OpenAI's GPT-6 Sol and GPT-6 Luna are live at $2 / $10 and $0.10 / $0.50 per 1M tokens.",
		date: "2026-09-22",
		type: "changelog",
	},
];

export const USAGE_ALERTS = [
	{
		id: "ntf_1",
		title: "API key nearing its period budget",
		message:
			"coding-agents has used 94% of its period budget. Review usage or adjust the limit before requests are blocked.",
		agoMinutes: 38,
		unread: true,
	},
	{
		id: "ntf_2",
		title: "Fireworks AI is experiencing errors",
		message:
			"Recent requests to Fireworks AI show elevated upstream errors. This provider served your traffic in the last 30 days. Check its status and consider another provider while it recovers.",
		agoMinutes: 95,
		unread: true,
	},
	{
		id: "ntf_3",
		title: "API key nearing its total budget",
		message:
			"support-bot has used 82% of its total budget. Review usage or adjust the limit before requests are blocked.",
		agoMinutes: 2_880,
		unread: false,
	},
];

export interface DemoAgent {
	id: string;
	share: number;
	lastActiveMinutes: number;
	models: Record<string, number>;
}

export const DEMO_AGENTS: DemoAgent[] = [
	{
		id: "claude.com/claude-code",
		share: 0.38,
		lastActiveMinutes: 2,
		models: {
			"anthropic/claude-sonnet-5": 0.64,
			"openai/gpt-6-sol": 0.21,
			"fireworks/kimi-k3": 0.15,
		},
	},
	{
		id: "devpass-code",
		share: 0.24,
		lastActiveMinutes: 9,
		models: {
			"fireworks/kimi-k3": 0.46,
			"zai/glm-5.3": 0.31,
			"deepseek/deepseek-v4.1-flash": 0.23,
		},
	},
	{
		id: "cursor",
		share: 0.17,
		lastActiveMinutes: 24,
		models: {
			"anthropic/claude-sonnet-5": 0.52,
			"openai/gpt-6-sol": 0.48,
		},
	},
	{
		id: "codex",
		share: 0.12,
		lastActiveMinutes: 47,
		models: {
			"openai/gpt-6-sol": 0.78,
			"openai/gpt-6-luna": 0.22,
		},
	},
	{
		id: "opencode",
		share: 0.06,
		lastActiveMinutes: 130,
		models: {
			"deepseek/deepseek-v4.1-flash": 0.55,
			"google-vertex/gemini-3.8-flash": 0.45,
		},
	},
	{
		id: "cline",
		share: 0.03,
		lastActiveMinutes: 1_440,
		models: {
			"anthropic/claude-sonnet-5": 1,
		},
	},
];

export interface DemoApiKeyDetail {
	id: string;
	maskedToken: string;
	status: "active" | "inactive";
	createdDaysAgo: number;
	creatorId: string;
	usageLimit: number | null;
	periodLimit: { amount: number; days: number } | null;
	iamRules: number;
	expiresInDays: number | null;
	retired?: { description: string; usage: number };
}

export const DEMO_API_KEY_DETAILS: DemoApiKeyDetail[] = [
	{
		id: "key_coding",
		maskedToken: "llmgtwy_7Kq2…f9Rz",
		status: "active",
		createdDaysAgo: 214,
		creatorId: "usr_leo",
		usageLimit: null,
		periodLimit: { amount: 6_000, days: 30 },
		iamRules: 2,
		expiresInDays: null,
	},
	{
		id: "key_support",
		maskedToken: "llmgtwy_Xc81…2mDa",
		status: "active",
		createdDaysAgo: 401,
		creatorId: "usr_sam",
		usageLimit: 48_000,
		periodLimit: null,
		iamRules: 1,
		expiresInDays: null,
	},
	{
		id: "key_pipeline",
		maskedToken: "llmgtwy_Pn4t…kW0e",
		status: "active",
		createdDaysAgo: 162,
		creatorId: "usr_priya",
		usageLimit: null,
		periodLimit: { amount: 3_500, days: 7 },
		iamRules: 0,
		expiresInDays: null,
	},
	{
		id: "key_search",
		maskedToken: "llmgtwy_bR6s…Lq3v",
		status: "active",
		createdDaysAgo: 88,
		creatorId: "usr_sam",
		usageLimit: null,
		periodLimit: null,
		iamRules: 0,
		expiresInDays: 41,
	},
	{
		id: "key_legal",
		maskedToken: "llmgtwy_Ze9m…H1cu",
		status: "active",
		createdDaysAgo: 36,
		creatorId: "usr_maya",
		usageLimit: 2_500,
		periodLimit: null,
		iamRules: 3,
		expiresInDays: null,
	},
	{
		id: "key_hackathon",
		maskedToken: "llmgtwy_Ja0w…pT7n",
		status: "inactive",
		createdDaysAgo: 290,
		creatorId: "usr_leo",
		usageLimit: 500,
		periodLimit: null,
		iamRules: 0,
		expiresInDays: null,
		retired: { description: "hackathon-2026", usage: 412.37 },
	},
];

export const DEMO_USER_NAMES: Record<string, string> = Object.fromEntries(
	USER_SHARES.map((user) => [user.id, user.name]),
);

export const ROUTING_WEIGHTS = [
	{
		label: "Price",
		help: "Weight for cost-based ranking",
		value: DEFAULT_ROUTING_WEIGHTS.price,
	},
	{
		label: "Uptime",
		help: "Weight for provider availability",
		value: DEFAULT_ROUTING_WEIGHTS.uptime,
	},
	{
		label: "Throughput",
		help: "Weight for tokens-per-second efficiency",
		value: DEFAULT_ROUTING_WEIGHTS.throughput,
	},
	{
		label: "Latency",
		help: "Weight for streaming response time",
		value: DEFAULT_ROUTING_WEIGHTS.latency,
	},
	{
		label: "Cache",
		help: "Bonus for providers with prompt caching",
		value: DEFAULT_ROUTING_WEIGHTS.cache,
	},
];

export const ROUTING_RETRY = [
	{
		label: "Max Retries",
		help: "Maximum cross-provider fallback attempts",
		value: DEFAULT_ROUTING_RETRY.maxRetries,
	},
	{
		label: "Low Uptime Fallback (%)",
		help: "If requested provider is below this, reroute automatically",
		value: DEFAULT_ROUTING_RETRY.lowUptimeFallbackThreshold,
	},
];

export const ROUTING_PROVIDER_PRIORITIES = [
	{ providerId: "anthropic", priority: 1 },
	{ providerId: "aws-bedrock", priority: 1 },
	{ providerId: "google-vertex", priority: 1 },
	{ providerId: "openai", priority: 1 },
	{ providerId: "azure", priority: 0.8 },
	{ providerId: "fireworks", priority: 0 },
];

export const SMART_ROUTING_MODELS = [
	"claude-sonnet-5",
	"gpt-6-sol",
	"gemini-3.8-flash",
	"deepseek-v4.1-flash",
];

export const SDK_SETTINGS = {
	markupPercent: 15,
	bonusPercent: 0,
	allowedOrigins: ["https://app.acme.com", "https://staging.acme.com"],
	brandName: "Acme Assist",
	supportEmail: "billing@acme.com",
	descriptorSuffix: "ACME AI",
	platformKeys: [
		{
			id: "pk_live",
			description: "Production backend",
			mode: "live" as const,
			maskedToken: "llmgtwy_plat_live_4Rm…a8Qe",
		},
		{
			id: "pk_test",
			description: "Local development",
			mode: "test" as const,
			maskedToken: "llmgtwy_plat_test_n2V…Yy0k",
		},
	],
};
