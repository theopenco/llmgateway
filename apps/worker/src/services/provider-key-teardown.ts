import {
	and,
	cdb,
	eq,
	lte,
	PROVIDER_KEY_DELETION_GRACE_SECONDS,
	tables,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

const GRACE_MS = PROVIDER_KEY_DELETION_GRACE_SECONDS * 1000;

/**
 * Finish deleting provider keys whose teardown grace period has passed. Until
 * then a "pending_deletion" key still serves conversations pinned to it by
 * replayed reasoning; afterwards nothing can use it. Idempotent, so every
 * worker may run it.
 */
export async function tearDownPendingProviderKeys(
	now: Date = new Date(),
): Promise<number> {
	const cutoff = new Date(now.getTime() - GRACE_MS);
	const tornDown = await cdb
		.update(tables.providerKey)
		.set({ status: "deleted" })
		.where(
			and(
				eq(tables.providerKey.status, "pending_deletion"),
				lte(tables.providerKey.deletionRequestedAt, cutoff),
			),
		)
		.returning({ id: tables.providerKey.id });
	if (tornDown.length > 0) {
		logger.info("Tore down pending-deletion provider keys", {
			count: tornDown.length,
		});
	}
	return tornDown.length;
}
