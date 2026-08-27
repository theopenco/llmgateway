/* eslint-disable no-console */
/**
 * Replace legacy plaintext provider keys with authenticated ciphertext,
 * display masks, and stable fingerprints. Existing mixed deployments remain
 * compatible while this script runs.
 *
 * Usage:
 *   pnpm --filter @llmgateway/scripts backfill-provider-key-encryption
 *   pnpm --filter @llmgateway/scripts backfill-provider-key-encryption --commit
 *   pnpm --filter @llmgateway/scripts backfill-provider-key-encryption --commit --batch-size=250
 *
 * Environment:
 *   DATABASE_URL                - defaults to local postgres if unset
 *   GATEWAY_API_KEY_HASH_SECRET - required with --commit
 */

import {
	encryptProviderKey,
	providerKeyEncryptionScope,
} from "@llmgateway/actions";
import {
	and,
	closeDatabase,
	db,
	drizzleCache,
	eq,
	getTableName,
	isNotNull,
	isNull,
	tables,
} from "@llmgateway/db";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";
import { maskToken } from "@llmgateway/shared/mask-token";

import {
	parseKeyStorageBackfillOptions,
	printKeyStorageBackfillHeader,
	requireExplicitHashSecret,
} from "./key-storage-backfill.js";

const legacyProviderKeyFilter = and(
	isNotNull(tables.providerKey.token),
	isNull(tables.providerKey.tokenCiphertext),
);

async function main(): Promise<void> {
	const options = parseKeyStorageBackfillOptions();
	printKeyStorageBackfillHeader(options);

	const pendingCount = await db.$count(
		tables.providerKey,
		legacyProviderKeyFilter,
	);
	console.log(`Legacy plaintext provider keys: ${pendingCount}`);

	if (!options.commit) {
		console.log("Dry run only. Re-run with --commit to migrate these rows.");
		return;
	}
	if (pendingCount === 0) {
		console.log("Nothing to backfill.");
		return;
	}

	requireExplicitHashSecret();
	let migrated = 0;

	while (true) {
		const rows = await db
			.select({
				id: tables.providerKey.id,
				organizationId: tables.providerKey.organizationId,
				token: tables.providerKey.token,
				updatedAt: tables.providerKey.updatedAt,
			})
			.from(tables.providerKey)
			.where(legacyProviderKeyFilter)
			.limit(options.batchSize);

		if (rows.length === 0) {
			break;
		}

		for (const row of rows) {
			if (row.token === null) {
				continue;
			}
			const updated = await db
				.update(tables.providerKey)
				.set({
					token: null,
					tokenCiphertext: encryptProviderKey(
						row.token,
						row.id,
						providerKeyEncryptionScope(row.organizationId),
					),
					tokenHash: getApiKeyFingerprint(row.token),
					tokenMasked: maskToken(row.token),
					updatedAt: row.updatedAt,
				})
				.where(
					and(
						eq(tables.providerKey.id, row.id),
						eq(tables.providerKey.token, row.token),
						isNull(tables.providerKey.tokenCiphertext),
					),
				)
				.returning({ id: tables.providerKey.id });
			migrated += updated.length;
		}

		console.log(`Migrated ${migrated}/${pendingCount} provider keys`);
	}

	if (migrated > 0) {
		await drizzleCache.onMutate({
			tables: getTableName(tables.providerKey),
		});
	}
	console.log(`Backfill complete. Migrated ${migrated} provider keys.`);
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
