/**
 * Script to generate random test logs for local development.
 * This helps test dashboards and visualizations with realistic data.
 *
 * Usage:
 *   npx tsx scripts/generate-test-logs.ts <count> <projectId> <apiKeyId> <organizationId>
 *
 * Example:
 *   npx tsx scripts/generate-test-logs.ts 1000 proj_123 key_456 org_789
 *
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string
 */

import { db, tables, shortid } from "@llmgateway/db";

// Model configurations with realistic distributions
const MODELS = [
	{
		id: "gpt-4o",
		provider: "openai",
		weight: 25,
		avgInputTokens: 500,
		avgOutputTokens: 300,
		inputCostPer1k: 0.005,
		outputCostPer1k: 0.015,
	},
	{
		id: "gpt-4o-mini",
		provider: "openai",
		weight: 30,
		avgInputTokens: 400,
		avgOutputTokens: 250,
		inputCostPer1k: 0.00015,
		outputCostPer1k: 0.0006,
	},
	{
		id: "claude-3-5-sonnet-20241022",
		provider: "anthropic",
		weight: 20,
		avgInputTokens: 600,
		avgOutputTokens: 400,
		inputCostPer1k: 0.003,
		outputCostPer1k: 0.015,
	},
	{
		id: "claude-3-5-haiku-20241022",
		provider: "anthropic",
		weight: 10,
		avgInputTokens: 350,
		avgOutputTokens: 200,
		inputCostPer1k: 0.0008,
		outputCostPer1k: 0.004,
	},
	{
		id: "gemini-2.5-pro",
		provider: "google-ai-studio",
		weight: 8,
		avgInputTokens: 550,
		avgOutputTokens: 350,
		inputCostPer1k: 0.00125,
		outputCostPer1k: 0.005,
	},
	{
		id: "gemini-2.5-flash",
		provider: "google-ai-studio",
		weight: 5,
		avgInputTokens: 300,
		avgOutputTokens: 200,
		inputCostPer1k: 0.000075,
		outputCostPer1k: 0.0003,
	},
	{
		id: "deepseek-chat",
		provider: "deepseek",
		weight: 2,
		avgInputTokens: 400,
		avgOutputTokens: 300,
		inputCostPer1k: 0.00014,
		outputCostPer1k: 0.00028,
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
	return Math.random() * (max - min) + min;
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

	// Add variance to token counts (50-150% of average)
	const inputTokens = Math.round(
		model.avgInputTokens * randomFloat(0.5, 1.5),
	);
	const outputTokens = Math.round(
		model.avgOutputTokens * randomFloat(0.5, 1.5),
	);
	const totalTokens = inputTokens + outputTokens;

	// Calculate costs
	const inputCost = (inputTokens / 1000) * model.inputCostPer1k;
	const outputCost = (outputTokens / 1000) * model.outputCostPer1k;
	const cost = inputCost + outputCost;

	// Random duration (100ms - 5000ms, with most being fast)
	const duration = Math.round(
		Math.pow(randomFloat(10, 70), 2), // Skewed towards faster responses
	);

	// Error states based on finish reason
	const hasError = ["upstream_error", "client_error", "gateway_error"].includes(
		finishReason.reason,
	);

	// Random flags
	const streamed = Math.random() > 0.3; // 70% are streamed
	const cached = Math.random() > 0.9; // 10% are cached

	// Time to first token (only for streamed, 50-500ms)
	const timeToFirstToken = streamed ? randomInt(50, 500) : null;

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
		responseSize: outputTokens * 4, // Rough estimate
		promptTokens: String(inputTokens),
		completionTokens: String(outputTokens),
		totalTokens: String(totalTokens),
		cost,
		inputCost,
		outputCost,
		requestCost: 0,
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
		temperature: randomFloat(0, 1),
		maxTokens: randomInt(100, 4000),
	};
}

async function main() {
	const args = process.argv.slice(2);

	if (args.length < 4) {
		console.log(
			"Usage: npx tsx scripts/generate-test-logs.ts <count> <projectId> <apiKeyId> <organizationId> [daysBack]",
		);
		console.log("\nExample:");
		console.log(
			"  npx tsx scripts/generate-test-logs.ts 1000 proj_123 key_456 org_789 30",
		);
		console.log("\nArguments:");
		console.log("  count          - Number of logs to generate");
		console.log("  projectId      - Project ID to associate logs with");
		console.log("  apiKeyId       - API Key ID to associate logs with");
		console.log("  organizationId - Organization ID to associate logs with");
		console.log("  daysBack       - How many days back to spread logs (default: 30)");
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

	console.log("\nDone! Generated logs summary:");

	// Print summary stats
	const modelCounts: Record<string, number> = {};
	const logs = Array.from({ length: Math.min(count, 10000) }, () =>
		generateLog(projectId, apiKeyId, organizationId, daysBack),
	);
	for (const log of logs) {
		modelCounts[log.usedModel] = (modelCounts[log.usedModel] || 0) + 1;
	}

	console.log("\nModel distribution (sample):");
	for (const [model, modelCount] of Object.entries(modelCounts).sort(
		(a, b) => b[1] - a[1],
	)) {
		const pct = ((modelCount / logs.length) * 100).toFixed(1);
		console.log(`  ${model}: ${pct}%`);
	}

	process.exit(0);
}

main().catch((err) => {
	console.error("Error:", err);
	process.exit(1);
});
