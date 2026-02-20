/* eslint-disable no-console */
/**
 * Script to generate random test logs for local development.
 * This helps test dashboards and visualizations with realistic data.
 *
 * Usage:
 *   pnpm --filter @llmgateway/scripts generate-test-logs 1000 proj_123 key_456 org_789
 *
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string
 */

import { customAlphabet } from "nanoid";

import { db, tables } from "@llmgateway/db";

const generate = customAlphabet(
	"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
);
const shortid = (size = 20) => generate(size);

// Model configurations with realistic distributions
// discount is applied to smaller/cheaper models (0.3 = 30% discount)
// cachedInputCostPer1k is typically 50% of input cost (or 0 if model doesn't support caching)
const MODELS = [
	{
		id: "gpt-4o",
		provider: "openai",
		weight: 25,
		avgInputTokens: 500,
		avgOutputTokens: 300,
		inputCostPer1k: 0.005,
		outputCostPer1k: 0.015,
		cachedInputCostPer1k: 0.0025,
		cacheChance: 0.35,
		discount: 0,
	},
	{
		id: "gpt-4o-mini",
		provider: "openai",
		weight: 30,
		avgInputTokens: 400,
		avgOutputTokens: 250,
		inputCostPer1k: 0.00015,
		outputCostPer1k: 0.0006,
		cachedInputCostPer1k: 0.000075,
		cacheChance: 0.4,
		discount: 0.3,
	},
	{
		id: "claude-3-5-sonnet-20241022",
		provider: "anthropic",
		weight: 20,
		avgInputTokens: 600,
		avgOutputTokens: 400,
		inputCostPer1k: 0.003,
		outputCostPer1k: 0.015,
		cachedInputCostPer1k: 0.0003,
		cacheChance: 0.3,
		discount: 0,
	},
	{
		id: "claude-3-5-haiku-20241022",
		provider: "anthropic",
		weight: 10,
		avgInputTokens: 350,
		avgOutputTokens: 200,
		inputCostPer1k: 0.0008,
		outputCostPer1k: 0.004,
		cachedInputCostPer1k: 0.00008,
		cacheChance: 0.25,
		discount: 0.3,
	},
	{
		id: "gemini-2.5-pro",
		provider: "google-ai-studio",
		weight: 8,
		avgInputTokens: 550,
		avgOutputTokens: 350,
		inputCostPer1k: 0.00125,
		outputCostPer1k: 0.005,
		cachedInputCostPer1k: 0.000315,
		cacheChance: 0.3,
		discount: 0,
	},
	{
		id: "gemini-2.5-flash",
		provider: "google-ai-studio",
		weight: 5,
		avgInputTokens: 300,
		avgOutputTokens: 200,
		inputCostPer1k: 0.000075,
		outputCostPer1k: 0.0003,
		cachedInputCostPer1k: 0.00001875,
		cacheChance: 0.35,
		discount: 0.3,
	},
	{
		id: "deepseek-chat",
		provider: "deepseek",
		weight: 2,
		avgInputTokens: 400,
		avgOutputTokens: 300,
		inputCostPer1k: 0.00014,
		outputCostPer1k: 0.00028,
		cachedInputCostPer1k: 0.000014,
		cacheChance: 0.2,
		discount: 0.3,
	},
];

const FINISH_REASONS = [
	{ reason: "completed", weight: 85 },
	{ reason: "length_limit", weight: 5 },
	{ reason: "tool_calls", weight: 5 },
	{ reason: "content_filter", weight: 1 },
	{ reason: "canceled", weight: 1 },
	{ reason: "upstream_error", weight: 2 },
	{ reason: "client_error", weight: 1 },
];

function weightedRandom<T extends { weight: number }>(items: T[]): T {
	const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
	let random = Math.random() * totalWeight;

	for (const item of items) {
		random -= item.weight;
		if (random <= 0) {
			return item;
		}
	}

	return items[items.length - 1];
}

function randomInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number): number {
	// eslint-disable-next-line no-mixed-operators
	return Math.random() * (max - min) + min;
}

// Log-normal distribution for more realistic heavy-tailed randomness
// Most values cluster near the median, but occasional large outliers occur
function logNormalRandom(median: number, sigma: number): number {
	const u1 = Math.random();
	const u2 = Math.random();
	const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
	return median * Math.exp(sigma * z);
}

function randomDate(daysBack: number): Date {
	const now = new Date();
	const msBack = randomInt(0, daysBack * 24 * 60 * 60 * 1000);
	return new Date(now.getTime() - msBack);
}

function generateLog(
	projectId: string,
	apiKeyId: string,
	organizationId: string,
	daysBack: number,
) {
	const model = weightedRandom(MODELS);
	const finishReason = weightedRandom(FINISH_REASONS);

	// Use log-normal distribution for wide, realistic variance
	// sigma=0.8 gives roughly 2x-5x spread in either direction from the median
	const inputTokens = Math.max(
		1,
		Math.round(logNormalRandom(model.avgInputTokens, 0.8)),
	);
	const outputTokens = Math.max(
		1,
		Math.round(logNormalRandom(model.avgOutputTokens, 0.9)),
	);

	// Determine if this request has cached input tokens
	const hasCachedTokens = Math.random() < model.cacheChance;
	// Cached tokens are a portion (20-80%) of the input tokens
	const cachedTokens = hasCachedTokens
		? Math.round(inputTokens * randomFloat(0.2, 0.8))
		: 0;

	const totalTokens = inputTokens + outputTokens;

	// Calculate costs (before discount)
	// For cached tokens, use the cheaper cached input price
	const uncachedInputTokens = inputTokens - cachedTokens;
	const inputCostBeforeDiscount =
		(uncachedInputTokens / 1000) * model.inputCostPer1k;
	const cachedInputCostBeforeDiscount =
		(cachedTokens / 1000) * model.cachedInputCostPer1k;
	const outputCostBeforeDiscount =
		(outputTokens / 1000) * model.outputCostPer1k;
	const costBeforeDiscount =
		inputCostBeforeDiscount +
		cachedInputCostBeforeDiscount +
		outputCostBeforeDiscount;

	// Apply discount if model has one
	const discount = model.discount;
	const discountMultiplier = 1 - discount;
	const inputCost = inputCostBeforeDiscount * discountMultiplier;
	const cachedInputCost = cachedInputCostBeforeDiscount * discountMultiplier;
	const outputCost = outputCostBeforeDiscount * discountMultiplier;
	const cost = costBeforeDiscount * discountMultiplier;

	// Log-normal duration for wide spread (most fast, some very slow)
	const duration = Math.max(
		50,
		Math.round(logNormalRandom(800, 1.0)),
	);

	// Error states based on finish reason
	const hasError = ["upstream_error", "client_error", "gateway_error"].includes(
		finishReason.reason,
	);

	// Random flags
	const streamed = Math.random() > 0.3; // 70% are streamed
	const cached = Math.random() > 0.9; // 10% are cached

	// Time to first token (only for streamed, log-normal for variability)
	const timeToFirstToken = streamed
		? Math.max(20, Math.round(logNormalRandom(150, 0.7)))
		: null;

	// Generate date within the specified range
	const createdAt = randomDate(daysBack);

	const id = shortid();

	return {
		id,
		requestId: id,
		createdAt,
		updatedAt: createdAt,
		organizationId,
		projectId,
		apiKeyId,
		duration,
		timeToFirstToken,
		requestedModel: model.id,
		requestedProvider: model.provider,
		usedModel: model.id,
		usedProvider: model.provider,
		responseSize: outputTokens * randomInt(3, 6), // Variable bytes-per-token estimate
		promptTokens: String(inputTokens),
		completionTokens: String(outputTokens),
		totalTokens: String(totalTokens),
		cachedTokens: cachedTokens > 0 ? String(cachedTokens) : null,
		cost,
		inputCost,
		outputCost,
		cachedInputCost: cachedTokens > 0 ? cachedInputCost : null,
		requestCost: 0,
		discount,
		hasError,
		finishReason: finishReason.reason,
		unifiedFinishReason: finishReason.reason,
		streamed,
		cached,
		mode: "credits" as const,
		usedMode: "credits" as const,
		messages: JSON.stringify([
			{ role: "user", content: "Test message for visualization" },
		]),
		temperature: randomFloat(0, 1.5),
		maxTokens: Math.round(logNormalRandom(2000, 0.6)),
	};
}

async function main() {
	const args = process.argv.slice(2);

	if (args.length < 4) {
		console.log(
			"Usage: pnpm --filter @llmgateway/scripts generate-test-logs <count> <projectId> <apiKeyId> <organizationId> [daysBack]",
		);
		console.log("\nExample:");
		console.log(
			"  pnpm --filter @llmgateway/scripts generate-test-logs 1000 proj_123 key_456 org_789 30",
		);
		console.log("\nArguments:");
		console.log("  count          - Number of logs to generate");
		console.log("  projectId      - Project ID to associate logs with");
		console.log("  apiKeyId       - API Key ID to associate logs with");
		console.log("  organizationId - Organization ID to associate logs with");
		console.log(
			"  daysBack       - How many days back to spread logs (default: 30)",
		);
		process.exit(1);
	}

	const count = parseInt(args[0], 10);
	const projectId = args[1];
	const apiKeyId = args[2];
	const organizationId = args[3];
	const daysBack = parseInt(args[4] || "30", 10);

	if (isNaN(count) || count <= 0) {
		console.error("Error: count must be a positive integer");
		process.exit(1);
	}

	console.log(`Generating ${count} test logs...`);
	console.log(`  Project ID: ${projectId}`);
	console.log(`  API Key ID: ${apiKeyId}`);
	console.log(`  Organization ID: ${organizationId}`);
	console.log(`  Days back: ${daysBack}`);

	// Generate logs in batches of 1000
	const batchSize = 1000;
	let generated = 0;

	while (generated < count) {
		const batchCount = Math.min(batchSize, count - generated);
		const logs = Array.from({ length: batchCount }, () =>
			generateLog(projectId, apiKeyId, organizationId, daysBack),
		);

		await db.insert(tables.log).values(logs);
		generated += batchCount;

		const progress = Math.round((generated / count) * 100);
		console.log(`  Progress: ${generated}/${count} (${progress}%)`);
	}

	console.log("\nDone!");
	process.exit(0);
}

main().catch((err) => {
	console.error("Error:", err);
	process.exit(1);
});
