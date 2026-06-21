/**
 * Demo-data augmentation for the new per-member / per-API-key analytics.
 *
 * The base seed only populates project-level hourly stats, so the Members and
 * API-key statistics pages would be empty. This script backfills api-key-level
 * hourly stats (attributed to several members via apiKey.createdBy) for the
 * enterprise "DataFlow AI" organization so every new page renders rich data.
 * Safe to re-run (idempotent via ON CONFLICT).
 */
import { closeDatabase, db, tables } from "./index.js";

const ORG_ID = "org-dataflow";

const MODELS = [
	{
		model: "claude-3.5-sonnet",
		provider: "anthropic",
		inPrice: 0.003,
		outPrice: 0.015,
	},
	{ model: "gpt-4o", provider: "openai", inPrice: 0.0025, outPrice: 0.01 },
	{
		model: "gpt-4o-mini",
		provider: "openai",
		inPrice: 0.00015,
		outPrice: 0.0006,
	},
	{ model: "o1", provider: "openai", inPrice: 0.015, outPrice: 0.06 },
	{
		model: "claude-3-haiku",
		provider: "anthropic",
		inPrice: 0.00025,
		outPrice: 0.00125,
	},
	{ model: "gpt-4", provider: "openai", inPrice: 0.03, outPrice: 0.06 },
];

interface KeyDef {
	id: string;
	projectId: string;
	description: string;
	create?: boolean;
}

interface OwnerDef {
	userId: string;
	weight: number;
	keys: KeyDef[];
}

const OWNERS: OwnerDef[] = [
	{
		userId: "user-carol",
		weight: 1,
		keys: [
			{
				id: "apikey-7",
				projectId: "proj-org-dataflow-0",
				description: "Primary Key",
			},
			{
				id: "apikey-8",
				projectId: "proj-org-dataflow-0",
				description: "CI/CD Key",
			},
		],
	},
	{
		userId: "user-elena",
		weight: 0.62,
		keys: [
			{
				id: "apikey-demo-elena-1",
				projectId: "proj-org-dataflow-0",
				description: "Elena Dev Key",
				create: true,
			},
			{
				id: "apikey-demo-elena-2",
				projectId: "proj-org-dataflow-1",
				description: "Elena Staging Key",
				create: true,
			},
		],
	},
	{
		userId: "user-dave",
		weight: 0.4,
		keys: [
			{
				id: "apikey-demo-dave-1",
				projectId: "proj-org-dataflow-0",
				description: "Dave Local Key",
				create: true,
			},
		],
	},
	{
		userId: "user-frank",
		weight: 0.24,
		keys: [
			{
				id: "apikey-demo-frank-1",
				projectId: "proj-org-dataflow-2",
				description: "Frank Test Key",
				create: true,
			},
		],
	},
];

const HOURS = [1, 4, 7, 10, 13, 16, 19, 22];

function hourBucket(dayOffset: number, hour: number): Date {
	const now = new Date();
	const d = new Date(
		Date.UTC(
			now.getUTCFullYear(),
			now.getUTCMonth(),
			now.getUTCDate(),
			hour,
			0,
			0,
			0,
		),
	);
	d.setUTCDate(d.getUTCDate() - dayOffset);
	return d;
}

function rand(min: number, max: number): number {
	return min + (max - min) * Math.random(); // eslint-disable-line no-mixed-operators
}

async function main(): Promise<void> {
	const keyStatsRows: (typeof tables.apiKeyHourlyStats.$inferInsert)[] = [];
	const keyModelStatsRows: (typeof tables.apiKeyHourlyModelStats.$inferInsert)[] =
		[];

	for (const owner of OWNERS) {
		// Create demo API keys for members that don't already own one.
		for (const key of owner.keys) {
			if (key.create) {
				await db
					.insert(tables.apiKey)
					.values({
						id: key.id,
						token: `sk-demo-${key.id}`,
						projectId: key.projectId,
						description: key.description,
						createdBy: owner.userId,
						keyType: "user",
						status: "active",
					})
					.onConflictDoNothing();
			}
		}

		for (const key of owner.keys) {
			for (let dayOffset = 0; dayOffset <= 6; dayOffset++) {
				for (const hour of HOURS) {
					const ts = hourBucket(dayOffset, hour);
					// Diurnal-ish shape so the over-time chart has texture.
					// eslint-disable-next-line no-mixed-operators
					const activityFactor = 0.5 + Math.sin((hour / 24) * Math.PI) ** 2;

					let hourRequests = 0;
					let hourErrors = 0;
					let hourCache = 0;
					let hourInputTokens = 0;
					let hourOutputTokens = 0;
					let hourCost = 0;
					let hourInputCost = 0;
					let hourOutputCost = 0;

					// Each key uses a rotating subset of models.
					const modelCount = 3 + Math.floor(rand(0, 3));
					for (let m = 0; m < modelCount; m++) {
						const model =
							MODELS[(key.id.length + dayOffset + m) % MODELS.length];
						const requestCount = Math.max(
							1,
							Math.round(owner.weight * activityFactor * rand(2, 10)),
						);
						const inputTokens = Math.round(requestCount * rand(350, 900));
						const outputTokens = Math.round(requestCount * rand(180, 520));
						const totalTokens = inputTokens + outputTokens;
						const inputCost = (inputTokens / 1000) * model.inPrice;
						const outputCost = (outputTokens / 1000) * model.outPrice;
						const cost = inputCost + outputCost;
						const errorCount = Math.random() < 0.15 ? 1 : 0;
						const cacheCount = Math.round(requestCount * rand(0, 0.25));

						hourRequests += requestCount;
						hourErrors += errorCount;
						hourCache += cacheCount;
						hourInputTokens += inputTokens;
						hourOutputTokens += outputTokens;
						hourCost += cost;
						hourInputCost += inputCost;
						hourOutputCost += outputCost;

						keyModelStatsRows.push({
							id: `akms-${key.id}-${dayOffset}-${hour}-${model.model}`,
							apiKeyId: key.id,
							projectId: key.projectId,
							hourTimestamp: ts,
							usedModel: model.model,
							usedProvider: model.provider,
							requestCount,
							errorCount,
							cacheCount,
							inputTokens: String(inputTokens),
							outputTokens: String(outputTokens),
							totalTokens: String(totalTokens),
							cost,
							inputCost,
							outputCost,
						});
					}

					keyStatsRows.push({
						id: `aks-${key.id}-${dayOffset}-${hour}`,
						apiKeyId: key.id,
						projectId: key.projectId,
						hourTimestamp: ts,
						requestCount: hourRequests,
						errorCount: hourErrors,
						cacheCount: hourCache,
						inputTokens: String(hourInputTokens),
						outputTokens: String(hourOutputTokens),
						totalTokens: String(hourInputTokens + hourOutputTokens),
						cost: hourCost,
						inputCost: hourInputCost,
						outputCost: hourOutputCost,
					});
				}
			}
		}
	}

	const chunk = <T>(arr: T[], size: number): T[][] => {
		const out: T[][] = [];
		for (let i = 0; i < arr.length; i += size) {
			out.push(arr.slice(i, i + size));
		}
		return out;
	};

	for (const rows of chunk(keyStatsRows, 500)) {
		await db
			.insert(tables.apiKeyHourlyStats)
			.values(rows)
			.onConflictDoNothing();
	}
	for (const rows of chunk(keyModelStatsRows, 500)) {
		await db
			.insert(tables.apiKeyHourlyModelStats)
			.values(rows)
			.onConflictDoNothing();
	}

	// eslint-disable-next-line no-console
	console.log(
		`Inserted ${keyStatsRows.length} api-key hourly stats, ${keyModelStatsRows.length} model stats for ${ORG_ID}.`,
	);
}

main()
	.then(() => closeDatabase())
	.catch(async (err) => {
		// eslint-disable-next-line no-console
		console.error(err);
		await closeDatabase();
		process.exit(1);
	});
