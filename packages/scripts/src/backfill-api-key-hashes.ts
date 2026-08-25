/* eslint-disable no-console */
/**
 * Add fingerprints and display masks to legacy plaintext gateway API keys and
 * embeddable session tokens. Plaintext remains populated during the staged
 * rollout so the backfill is reversible.
 *
 * Usage:
 *   pnpm --filter @llmgateway/scripts backfill-api-key-hashes
 *   pnpm --filter @llmgateway/scripts backfill-api-key-hashes --commit
 *   pnpm --filter @llmgateway/scripts backfill-api-key-hashes --commit --batch-size=250
 *
 * Environment:
 *   DATABASE_URL                - defaults to local postgres if unset
 *   GATEWAY_API_KEY_HASH_SECRET - required with --commit
 */

import {
	and,
	closeDatabase,
	db,
	drizzleCache,
	eq,
	getTableName,
	isNotNull,
	isNull,
	notInArray,
	tables,
} from "@llmgateway/db";
import {
	hashApiKeyForBackfill,
	hashTokenForBackfill,
	parseKeyStorageBackfillOptions,
	printKeyStorageBackfillHeader,
	RETRIEVABLE_API_KEY_TYPES,
	requireExplicitHashSecret,
} from "./key-storage-backfill.js";

const legacyApiKeyFilter = and(
	isNotNull(tables.apiKey.token),
	isNull(tables.apiKey.tokenHash),
	notInArray(tables.apiKey.keyType, RETRIEVABLE_API_KEY_TYPES),
);

const legacyEndUserSessionFilter = and(
	isNotNull(tables.endUserSession.token),
	isNull(tables.endUserSession.tokenHash),
);

async function main(): Promise<void> {
	const options = parseKeyStorageBackfillOptions();
	printKeyStorageBackfillHeader(options);

	const pendingCount = await db.$count(tables.apiKey, legacyApiKeyFilter);
	const pendingSessionCount = await db.$count(
		tables.endUserSession,
		legacyEndUserSessionFilter,
	);
	console.log(`Legacy plaintext API keys: ${pendingCount}`);
	console.log(`Legacy plaintext embeddable sessions: ${pendingSessionCount}`);

	if (!options.commit) {
		console.log("Dry run only. Re-run with --commit to migrate these rows.");
		return;
	}
	if (pendingCount === 0 && pendingSessionCount === 0) {
		console.log("Nothing to backfill.");
		return;
	}

	requireExplicitHashSecret();
	let migrated = 0;

	while (true) {
		const rows = await db
			.select({
				id: tables.apiKey.id,
				token: tables.apiKey.token,
				updatedAt: tables.apiKey.updatedAt,
			})
			.from(tables.apiKey)
			.where(legacyApiKeyFilter)
			.limit(options.batchSize);

		if (rows.length === 0) {
			break;
		}

		for (const row of rows) {
			if (row.token === null) {
				continue;
			}
			const updated = await db
				.update(tables.apiKey)
				.set({
					...hashApiKeyForBackfill(row.token),
					updatedAt: row.updatedAt,
				})
				.where(
					and(
						eq(tables.apiKey.id, row.id),
						eq(tables.apiKey.token, row.token),
						isNull(tables.apiKey.tokenHash),
					),
				)
				.returning({ id: tables.apiKey.id });
			migrated += updated.length;
		}

		console.log(`Migrated ${migrated}/${pendingCount} API keys`);
	}

	if (migrated > 0) {
		await drizzleCache.onMutate({
			tables: getTableName(tables.apiKey),
		});
	}
	console.log(`Backfill complete. Migrated ${migrated} API keys.`);

	let migratedSessions = 0;
	while (true) {
		const rows = await db
			.select({
				id: tables.endUserSession.id,
				token: tables.endUserSession.token,
				updatedAt: tables.endUserSession.updatedAt,
			})
			.from(tables.endUserSession)
			.where(legacyEndUserSessionFilter)
			.limit(options.batchSize);

		if (rows.length === 0) {
			break;
		}

		for (const row of rows) {
			if (row.token === null) {
				continue;
			}
			const updated = await db
				.update(tables.endUserSession)
				.set({
					...hashTokenForBackfill(row.token),
					updatedAt: row.updatedAt,
				})
				.where(
					and(
						eq(tables.endUserSession.id, row.id),
						eq(tables.endUserSession.token, row.token),
						isNull(tables.endUserSession.tokenHash),
					),
				)
				.returning({ id: tables.endUserSession.id });
			migratedSessions += updated.length;
		}

		console.log(
			`Migrated ${migratedSessions}/${pendingSessionCount} embeddable sessions`,
		);
	}

	if (migratedSessions > 0) {
		await drizzleCache.onMutate({
			tables: getTableName(tables.endUserSession),
		});
	}
	console.log(
		`Backfill complete. Migrated ${migratedSessions} embeddable sessions.`,
	);
}

async function run(): Promise<void> {
	try {
		await main();
		await closeDatabase();
		process.exit(0);
	} catch (error: unknown) {
		console.error(error instanceof Error ? error.message : String(error));
		await closeDatabase().catch(() => undefined);
		process.exit(1);
	}
}

void run();
