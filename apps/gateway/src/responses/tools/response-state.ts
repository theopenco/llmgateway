import { and, db, eq, log } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

export interface StoredResponseData {
	id: string;
	input: unknown[];
	output: unknown[];
	instructions?: string;
	model: string;
	status: "completed" | "incomplete" | "failed";
	usage?: Record<string, unknown>;
	created_at?: number;
}

/**
 * Update the log entry's responsesApiData with the complete response data (including output).
 * The log entry was inserted synchronously with partial data (output: []).
 * This update fills in the full output for conversation chaining via previous_response_id.
 */
export async function storeResponse(
	logId: string,
	data: StoredResponseData,
): Promise<void> {
	try {
		await db
			.update(log)
			.set({ responsesApiData: data })
			.where(eq(log.id, logId));
	} catch (error) {
		logger.warn("Failed to update log with responsesApiData", {
			logId,
			error,
		});
	}
}

/**
 * Retrieve stored response data by log entry ID (primary key lookup).
 * Uses projectId for security scoping.
 */
export async function getStoredResponse(
	logId: string,
	projectId: string,
): Promise<StoredResponseData | null> {
	try {
		const rows = await db
			.select({ responsesApiData: log.responsesApiData })
			.from(log)
			.where(and(eq(log.id, logId), eq(log.projectId, projectId)))
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
			status?: "completed" | "incomplete" | "failed";
			usage?: Record<string, unknown>;
			created_at?: number;
		};

		return {
			id: logId,
			input: data.input,
			output: data.output,
			instructions: data.instructions,
			model: data.model ?? "",
			status: data.status ?? "completed",
			usage: data.usage,
			created_at: data.created_at,
		};
	} catch {
		return null;
	}
}
