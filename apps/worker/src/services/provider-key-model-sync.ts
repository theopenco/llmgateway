import {
	managedCredentialValidationOptions,
	probeProviderKeyModel,
	readProviderKey,
} from "@llmgateway/actions";
import {
	and,
	cdb,
	db,
	eq,
	gte,
	inArray,
	ne,
	sql,
	tables,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	getModelIdsByProvider,
	MODEL_SYNC_PROVIDERS,
} from "@llmgateway/shared";

import type {
	PlatformAuditLogAction,
	ProviderKeyModelSyncMetadata,
} from "@llmgateway/db";

export const MODEL_SYNC_ACTION =
	"provider_key.models_synced" satisfies PlatformAuditLogAction;

const HOUR = 60 * 60 * 1000;
// An hour short of a day, so the hourly check does not drift a run later
// every day.
const SYNC_INTERVAL_MS = 23 * HOUR;
// Bounded so the probe traffic cannot push the upstream into rate limits that
// would then read as failures.
const PROBE_BATCH_SIZE = 5;
const MAX_ERROR_LENGTH = 300;

type ProviderKeyRow = typeof tables.providerKey.$inferSelect;

export interface ProviderKeyModelSyncOptions {
	probe?: typeof probeProviderKeyModel;
	/** Called between probe batches, e.g. to keep the caller's lock alive. */
	onProgress?: () => Promise<void>;
	/** Aborts in-flight probes and ends the run without recording it. */
	signal?: AbortSignal;
}

async function syncKey(
	key: ProviderKeyRow,
	allowed: string[],
	options: ProviderKeyModelSyncOptions,
): Promise<boolean> {
	const probe = options.probe ?? probeProviderKeyModel;
	const token = readProviderKey(key);
	const validationOptions = managedCredentialValidationOptions(
		key.provider,
		key.config,
		key.region,
	);
	const candidates = (getModelIdsByProvider().get(key.provider) ?? []).filter(
		(modelId) =>
			!allowed.includes(modelId) && !key.modelSyncExcluded?.includes(modelId),
	);

	const added: string[] = [];
	const failed: ProviderKeyModelSyncMetadata["failed"] = [];
	let probed = 0;
	let skipped = 0;
	for (let i = 0; i < candidates.length; i += PROBE_BATCH_SIZE) {
		const results = await Promise.all(
			candidates.slice(i, i + PROBE_BATCH_SIZE).map((modelId) =>
				probe({
					provider: key.provider,
					token,
					modelId,
					validationOptions,
					abortSignal: options.signal,
				}),
			),
		);
		if (options.signal?.aborted) {
			// Aborted probes read as failures, so a partial run is not recorded;
			// the key is retried on the next check.
			return false;
		}
		for (const result of results) {
			if (result.valid === null) {
				skipped++;
				continue;
			}
			probed++;
			if (result.valid) {
				added.push(result.model);
			} else {
				failed.push({
					model: result.model,
					statusCode: result.statusCode,
					error: result.error?.slice(0, MAX_ERROR_LENGTH),
				});
			}
		}
		await options.onProgress?.();
	}

	if (added.length > 0) {
		const column = tables.providerKey.allowedModels;
		// Appends in SQL and only to a still-restricted key, so an edit made in
		// the admin dashboard while the probes ran is neither overwritten nor,
		// if it cleared the restriction, turned back into one.
		const [updated] = await cdb
			.update(tables.providerKey)
			.set({
				allowedModels: sql`${column} || ARRAY(SELECT m FROM unnest(ARRAY[${sql.join(
					added.map((modelId) => sql`${modelId}`),
					sql`, `,
				)}]::text[]) AS m WHERE m <> ALL(${column}))`,
			})
			.where(
				and(
					eq(tables.providerKey.id, key.id),
					eq(tables.providerKey.managed, true),
					ne(tables.providerKey.status, "deleted"),
					sql`cardinality(${column}) > 0`,
				),
			)
			.returning({ id: tables.providerKey.id });
		if (!updated) {
			logger.info("Provider key model sync skipped: key changed during run", {
				providerKeyId: key.id,
			});
			return false;
		}
	}

	await db.insert(tables.platformAuditLog).values({
		action: MODEL_SYNC_ACTION,
		resourceType: "provider_key",
		resourceId: key.id,
		metadata: { provider: key.provider, probed, skipped, added, failed },
	});
	logger.info("Provider key models synced", {
		providerKeyId: key.id,
		provider: key.provider,
		probed,
		added,
		failedCount: failed.length,
	});
	return true;
}

/**
 * Probes every catalogue model a restricted managed credential does not allow
 * yet and enables the ones its account now serves. Never removes a model, so a
 * temporary upstream failure cannot shrink a credential. Each credential is
 * synced at most once per interval; returns how many were synced.
 */
export async function syncProviderKeyModels(
	options: ProviderKeyModelSyncOptions = {},
): Promise<number> {
	const keys = (
		await db.query.providerKey.findMany({
			where: {
				managed: { eq: true },
				status: { eq: "active" },
				provider: { in: [...MODEL_SYNC_PROVIDERS] },
			},
		})
	).filter((key) => key.allowedModels && key.allowedModels.length > 0);
	if (keys.length === 0) {
		return 0;
	}

	const recent = await db
		.select({ resourceId: tables.platformAuditLog.resourceId })
		.from(tables.platformAuditLog)
		.where(
			and(
				eq(tables.platformAuditLog.action, MODEL_SYNC_ACTION),
				eq(tables.platformAuditLog.resourceType, "provider_key"),
				inArray(
					tables.platformAuditLog.resourceId,
					keys.map((key) => key.id),
				),
				gte(
					tables.platformAuditLog.createdAt,
					new Date(Date.now() - SYNC_INTERVAL_MS),
				),
			),
		);
	const recentlySynced = new Set(recent.map((row) => row.resourceId));

	let synced = 0;
	for (const key of keys) {
		if (options.signal?.aborted) {
			break;
		}
		if (recentlySynced.has(key.id)) {
			continue;
		}
		try {
			if (await syncKey(key, key.allowedModels ?? [], options)) {
				synced++;
			}
		} catch (error) {
			if (options.signal?.aborted) {
				break;
			}
			// One broken credential must not stop the others from syncing; it is
			// retried on the next check.
			logger.error(
				"Provider key model sync failed",
				error instanceof Error ? error : new Error(String(error)),
				{ providerKeyId: key.id, provider: key.provider },
			);
		}
	}
	return synced;
}
