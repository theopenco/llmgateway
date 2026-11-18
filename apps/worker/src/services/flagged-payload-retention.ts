import { db, lt, sql, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

const BATCH_SIZE = 1000;
const MAX_BATCHES_PER_RUN = 50;

/**
 * Deletes preserved content filter payloads past `expires_at`: 90 days after
 * they were flagged, or one year after an NCMEC report. Runs whatever
 * `ENABLE_DATA_RETENTION_CLEANUP` says, since the cap is part of the privacy
 * policy. Returns the number of rows deleted.
 */
export async function cleanupExpiredFlaggedPayloads(
	now = new Date(),
	isStopRequested: () => boolean = () => false,
): Promise<number> {
	const table = tables.contentFilterFlaggedPayload;
	let deleted = 0;
	for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
		if (isStopRequested()) {
			break;
		}
		const count = await db.transaction(async (tx) => {
			const expired = await tx
				.select({ id: table.id })
				.from(table)
				.where(lt(table.expiresAt, now))
				.orderBy(table.expiresAt)
				.limit(BATCH_SIZE)
				.for("update", { skipLocked: true });
			if (expired.length === 0) {
				return 0;
			}
			// One array bind keeps the statement text constant across batch sizes.
			await tx
				.delete(table)
				.where(
					sql`${table.id} = ANY(${sql.param(expired.map((row) => row.id))}::text[])`,
				);
			return expired.length;
		});
		deleted += count;
		if (count < BATCH_SIZE) {
			break;
		}
	}
	if (deleted > 0) {
		logger.info("Deleted expired flagged content filter payloads", {
			deleted,
		});
	}
	return deleted;
}
