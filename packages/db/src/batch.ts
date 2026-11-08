import { and, eq, inArray } from "drizzle-orm";

import { db } from "./db.js";
import { batchRequest } from "./schema.js";

const DELETE_CHUNK_SIZE = 5000;

type BatchRequestStatus = (typeof batchRequest.$inferSelect)["status"];

/** Deletes a batch's request rows in chunks, keeping each statement short. */
export async function deleteBatchRequests(
	batchId: string,
	statuses?: readonly BatchRequestStatus[],
) {
	for (;;) {
		const deleted = await db
			.delete(batchRequest)
			.where(
				inArray(
					batchRequest.id,
					db
						.select({ id: batchRequest.id })
						.from(batchRequest)
						.where(
							and(
								eq(batchRequest.batchId, batchId),
								statuses
									? inArray(batchRequest.status, [...statuses])
									: undefined,
							),
						)
						.limit(DELETE_CHUNK_SIZE),
				),
			)
			.returning({ id: batchRequest.id });
		if (deleted.length < DELETE_CHUNK_SIZE) {
			return;
		}
	}
}
