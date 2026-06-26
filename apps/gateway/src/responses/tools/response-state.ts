import { redisClient } from "@llmgateway/cache";
import { and, db, desc, eq, gte, log, sql } from "@llmgateway/db";
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

// TTL for the per-item index used to resolve `item_reference` input items.
// The Responses API requires full data retention, so a generous window is safe;
// in practice references are resolved on the immediately following turn.
const ITEM_INDEX_TTL_SECONDS = 30 * 24 * 60 * 60;

// Only the DB fallback for item resolution scans rows within this recent window
// to keep the (un-indexed) JSONB containment query bounded.
const ITEM_FALLBACK_LOOKBACK_MS = ITEM_INDEX_TTL_SECONDS * 1000;

function itemIndexKey(projectId: string, itemId: string): string {
	return `responses:item:${projectId}:${itemId}`;
}

/**
 * Index individual response items (by their `id`) so they can later be resolved
 * from an `item_reference` input item. Stateful clients reference prior items
 * (e.g. a `function_call` the gateway emitted) by id instead of re-sending them.
 */
async function indexResponseItems(
	projectId: string,
	items: unknown[],
): Promise<void> {
	const writes: Promise<unknown>[] = [];
	for (const item of items) {
		if (!item || typeof item !== "object") {
			continue;
		}
		const id = (item as { id?: unknown }).id;
		const type = (item as { type?: unknown }).type;
		// item_reference items are pointers, not concrete items — never index them.
		if (typeof id !== "string" || typeof type !== "string") {
			continue;
		}
		if (type === "item_reference") {
			continue;
		}
		writes.push(
			redisClient.set(
				itemIndexKey(projectId, id),
				JSON.stringify(item),
				"EX",
				ITEM_INDEX_TTL_SECONDS,
			),
		);
	}
	if (writes.length === 0) {
		return;
	}
	try {
		await Promise.all(writes);
	} catch (error) {
		logger.warn("Failed to index response items for item_reference", {
			projectId,
			error,
		});
	}
}

/**
 * Resolve an `item_reference` id to the concrete stored item it points at.
 * Tries the fast Redis index first, then falls back to a project-scoped lookup
 * over recently stored responses. Returns null when the item cannot be found.
 */
export async function resolveStoredItem(
	itemId: string,
	projectId: string,
): Promise<Record<string, unknown> | null> {
	try {
		const cached = await redisClient.get(itemIndexKey(projectId, itemId));
		if (cached) {
			return JSON.parse(cached) as Record<string, unknown>;
		}
	} catch (error) {
		logger.warn("Failed to read item index from Redis", { itemId, error });
	}

	// Fallback: scan recently stored responses for an output/input item with this
	// id. Bounded by project and a recent time window to keep the un-indexed
	// JSONB containment query cheap.
	try {
		const cutoff = new Date(Date.now() - ITEM_FALLBACK_LOOKBACK_MS);
		const match = sql`(${log.responsesApiData} -> 'output' @> ${JSON.stringify([{ id: itemId }])}::jsonb OR ${log.responsesApiData} -> 'input' @> ${JSON.stringify([{ id: itemId }])}::jsonb)`;
		const rows = await db
			.select({ responsesApiData: log.responsesApiData })
			.from(log)
			.where(
				and(eq(log.projectId, projectId), gte(log.createdAt, cutoff), match),
			)
			.orderBy(desc(log.createdAt))
			.limit(1);

		const data = rows[0]?.responsesApiData as
			| { input?: unknown[]; output?: unknown[] }
			| undefined;
		if (!data) {
			return null;
		}
		const found = [...(data.output ?? []), ...(data.input ?? [])].find(
			(it) =>
				it &&
				typeof it === "object" &&
				(it as { id?: unknown }).id === itemId &&
				(it as { type?: unknown }).type !== "item_reference",
		);
		return (found as Record<string, unknown>) ?? null;
	} catch (error) {
		logger.warn("Failed to resolve stored item from DB", { itemId, error });
		return null;
	}
}

/**
 * Replace any `item_reference` input items with the concrete stored items they
 * point at. Unresolvable references are dropped (with a warning) rather than
 * failing the whole request. Non-reference items pass through unchanged.
 */
export async function resolveItemReferences(
	inputItems: unknown[],
	projectId: string,
): Promise<unknown[]> {
	const hasReference = inputItems.some(
		(it) =>
			it &&
			typeof it === "object" &&
			(it as { type?: unknown }).type === "item_reference",
	);
	if (!hasReference) {
		return inputItems;
	}

	const resolved: unknown[] = [];
	for (const item of inputItems) {
		if (
			!item ||
			typeof item !== "object" ||
			(item as { type?: unknown }).type !== "item_reference"
		) {
			resolved.push(item);
			continue;
		}
		const id = (item as { id?: unknown }).id;
		if (typeof id !== "string") {
			continue;
		}
		const found = await resolveStoredItem(id, projectId);
		if (found) {
			resolved.push(found);
		} else {
			logger.warn("Dropping unresolvable item_reference", { id, projectId });
		}
	}
	return resolved;
}

/**
 * Update the log entry's responsesApiData with the complete response data (including output).
 * The log entry was inserted synchronously with partial data (output: []).
 * This update fills in the full output for conversation chaining via previous_response_id.
 */
export async function storeResponse(
	logId: string,
	data: StoredResponseData,
	projectId?: string,
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

	// Index items so future item_reference inputs can resolve them. Index both
	// input and output: input may carry items resolved on earlier turns, keeping
	// long-running references fresh.
	if (projectId) {
		await indexResponseItems(projectId, [
			...(data.output ?? []),
			...(data.input ?? []),
		]);
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
