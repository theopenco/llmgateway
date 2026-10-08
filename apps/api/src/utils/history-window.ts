import {
	db,
	and,
	eq,
	gte,
	lte,
	isNull,
	isNotNull,
	or,
	sql,
	aggregationProgress,
	model,
	modelProviderMapping,
	providerDraftModel,
	modelHistory,
	modelHistoryHourly,
	modelProviderMappingHistory,
	modelProviderMappingHistoryHourly,
} from "@llmgateway/db";

// Windows longer than 24h read the hourly rollup tables instead of the minute
// tables, so a 7d/30d/90d range scans hours rather than millions of minute rows.
export const HOURLY_BUCKET_THRESHOLD_MINUTES = 1440;

// Floor a date to the start of its hour so the hourly-table range filter aligns
// to bucket boundaries.
export function floorToHourStart(date: Date): Date {
	const d = new Date(date);
	d.setMinutes(0, 0, 0);
	return d;
}

// Whether a [from, to) range is long enough to be served from the hourly rollup.
export function isHourlyRange(from: Date, to: Date): boolean {
	return (
		to.getTime() - from.getTime() > HOURLY_BUCKET_THRESHOLD_MINUTES * 60 * 1000
	);
}

export function pickMappingHistoryTable(hourly: boolean): {
	table: typeof modelProviderMappingHistory;
	bucket:
		| typeof modelProviderMappingHistory.minuteTimestamp
		| typeof modelProviderMappingHistoryHourly.hourTimestamp;
} {
	if (hourly) {
		return {
			table:
				modelProviderMappingHistoryHourly as unknown as typeof modelProviderMappingHistory,
			bucket: modelProviderMappingHistoryHourly.hourTimestamp,
		};
	}
	return {
		table: modelProviderMappingHistory,
		bucket: modelProviderMappingHistory.minuteTimestamp,
	};
}

export function pickModelHistoryTable(hourly: boolean): {
	table: typeof modelHistory;
	bucket:
		| typeof modelHistory.minuteTimestamp
		| typeof modelHistoryHourly.hourTimestamp;
} {
	if (hourly) {
		return {
			table: modelHistoryHourly as unknown as typeof modelHistory,
			bucket: modelHistoryHourly.hourTimestamp,
		};
	}
	return {
		table: modelHistory,
		bucket: modelHistory.minuteTimestamp,
	};
}

// Coverage, rather than history row presence, distinguishes idle from unprocessed.
export async function fillIdleHistory<
	T extends { timestamp: string },
>(options: {
	rows: T[];
	idle: Omit<T, "timestamp">;
	hourly: boolean;
	from: Date;
	modelId?: string;
	providerId?: string;
	region?: string;
}): Promise<T[]> {
	const { rows, idle, hourly, from, modelId, providerId, region } = options;
	const catalogue = providerId
		? await db
				.select({
					createdAt: modelProviderMapping.createdAt,
					pausedAt: providerDraftModel.pausedAt,
					delistedAt: providerDraftModel.delistedAt,
					deactivatedAt: modelProviderMapping.deactivatedAt,
				})
				.from(modelProviderMapping)
				.leftJoin(
					providerDraftModel,
					and(
						eq(modelProviderMapping.source, "airside"),
						eq(providerDraftModel.providerId, modelProviderMapping.providerId),
						eq(providerDraftModel.modelName, modelProviderMapping.modelId),
						or(
							eq(providerDraftModel.status, "active"),
							eq(providerDraftModel.status, "delisted"),
						),
					),
				)
				.where(
					and(
						or(
							eq(modelProviderMapping.status, "active"),
							isNotNull(providerDraftModel.pausedAt),
							isNotNull(providerDraftModel.delistedAt),
							isNotNull(modelProviderMapping.deactivatedAt),
						),
						eq(modelProviderMapping.providerId, providerId),
						modelId ? eq(modelProviderMapping.modelId, modelId) : undefined,
						region !== undefined
							? eq(modelProviderMapping.region, region)
							: isNull(modelProviderMapping.region),
					),
				)
		: await db
				.select({
					createdAt: model.createdAt,
					pausedAt: sql<null>`null`,
					delistedAt: sql<null>`null`,
					deactivatedAt: sql<null>`null`,
				})
				.from(model)
				.where(and(eq(model.status, "active"), eq(model.id, modelId!)))
				.limit(1);
	if (!catalogue[0]) {
		return rows;
	}
	const interval = hourly ? 3_600_000 : 60_000;
	// A pause ends eligibility; it must not erase the preceding idle history.
	const windows = catalogue.map((entry) => ({
		from: Math.floor(entry.createdAt.getTime() / interval) * interval,
		until: Math.min(
			entry.pausedAt?.getTime() ?? Infinity,
			entry.delistedAt?.getTime() ?? Infinity,
			entry.deactivatedAt?.getTime() ?? Infinity,
		),
	}));
	const firstEligible = Math.min(...windows.map((window) => window.from));
	const coverage = await db
		.select({ bucket: aggregationProgress.bucketTimestamp })
		.from(aggregationProgress)
		.where(
			and(
				eq(aggregationProgress.job, hourly ? "hourly-usage" : "minute-usage"),
				gte(
					aggregationProgress.bucketTimestamp,
					new Date(Math.max(from.getTime(), firstEligible)),
				),
				lte(aggregationProgress.bucketTimestamp, new Date()),
				isNotNull(aggregationProgress.refreshedAt),
			),
		);
	const result = new Map(rows.map((row) => [row.timestamp, row]));
	for (const { bucket } of coverage) {
		if (
			!windows.some(
				(window) =>
					bucket.getTime() >= window.from && bucket.getTime() < window.until,
			)
		) {
			continue;
		}
		const timestamp = bucket.toISOString();
		if (!result.has(timestamp)) {
			result.set(timestamp, { ...idle, timestamp } as T);
		}
	}
	return [...result.values()].sort((a, b) =>
		a.timestamp.localeCompare(b.timestamp),
	);
}
