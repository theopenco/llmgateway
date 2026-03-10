import { redisClient } from "@llmgateway/cache";
import { and, db, eq, log, sql } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

const RESPONSE_TTL = 86400; // 24 hours
const RESPONSE_KEY_PREFIX = "responses:";

export interface StoredResponseData {
	id: string;
	input: unknown[];
	output: unknown[];
	instructions?: string;
	model: string;
}

/**
 * Store response data in Redis (immediate) and update PostgreSQL log entry (delayed).
 *
 * Redis provides immediate availability for follow-up requests.
 * PostgreSQL is updated with a delay to allow the async log queue to insert the entry first.
 */
export async function storeResponse(
	responseId: string,
	data: StoredResponseData,
	projectId?: string,
): Promise<void> {
	// Redis for immediate availability
	try {
		await redisClient.setex(
			`${RESPONSE_KEY_PREFIX}${responseId}`,
			RESPONSE_TTL,
			JSON.stringify(data),
		);
	} catch {
		// Non-critical: PostgreSQL fallback will be used after Redis expires
	}

	// Update the PostgreSQL log entry with complete responsesApiData.
	// The log entry was inserted via async queue with partial data (output: []).
	// This delayed update fills in the full output for long-term storage.
	if (projectId) {
		void updateLogResponsesData(responseId, projectId, data);
	}
}

async function updateLogResponsesData(
	responseId: string,
	projectId: string,
	data: StoredResponseData,
): Promise<void> {
	// Delay to let the async log queue process first
	await new Promise((r) => setTimeout(r, 3000));
	try {
		await db
			.update(log)
			.set({ responsesApiData: data })
			.where(
				and(eq(log.projectId, projectId), eq(log.responsesApiId, responseId)),
			);
	} catch (error) {
		logger.warn("Failed to update log with responsesApiData", {
			responseId,
			error,
		});
	}
}

export async function getStoredResponse(
	responseId: string,
	projectId: string,
): Promise<StoredResponseData | null> {
	// Try Redis first (fast path)
	try {
		const cached = await redisClient.get(`${RESPONSE_KEY_PREFIX}${responseId}`);
		if (cached) {
			return JSON.parse(cached) as StoredResponseData;
		}
	} catch {
		// Redis unavailable, fall through to PostgreSQL
	}

	// PostgreSQL fallback — query by project_id (uses existing index) + responses_api_id
	try {
		const rows = await db
			.select({ responsesApiData: log.responsesApiData })
			.from(log)
			.where(
				and(eq(log.projectId, projectId), eq(log.responsesApiId, responseId)),
			)
			.orderBy(sql`${log.createdAt} DESC`)
			.limit(1);

		const row = rows[0];
		if (!row?.responsesApiData) {
			return null;
		}

		const data = row.responsesApiData as {
			input: unknown[];
			output: unknown[];
			instructions?: string;
			model?: string;
		};

		const result: StoredResponseData = {
			id: responseId,
			input: data.input,
			output: data.output,
			instructions: data.instructions,
			model: data.model ?? "",
		};

		// Re-populate Redis cache for subsequent lookups
		try {
			await redisClient.setex(
				`${RESPONSE_KEY_PREFIX}${responseId}`,
				RESPONSE_TTL,
				JSON.stringify(result),
			);
		} catch {
			// Non-critical
		}

		return result;
	} catch {
		return null;
	}
}
