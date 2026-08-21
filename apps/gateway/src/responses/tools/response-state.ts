import crypto from "crypto";

import { swrWrap } from "@llmgateway/cache";
import {
	and,
	cdb,
	desc,
	eq,
	getTableName,
	gte,
	log,
	sql,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import { getResponsesStorage } from "./response-storage.js";

export interface StoredResponseData {
	id: string;
	input: unknown[];
	output: unknown[];
	instructions?: string;
	model: string;
	status: "completed" | "incomplete" | "failed";
	incomplete_details?: { reason: string } | null;
	reasoning?: {
		effort: string | null;
		summary: string | null;
		context?: string;
	} | null;
	usage?: Record<string, unknown>;
	created_at?: number;
}

// Stored responses (and the items they reference) are kept for 30 days,
// matching OpenAI's own Responses API retention, independent of the
// organization's data-retention policy.
export const RESPONSES_TTL_SECONDS = 30 * 24 * 60 * 60;

// Only the DB fallback (legacy responses stored in log.responsesApiData before
// the move to dedicated storage) scans rows within this recent window to keep
// the (un-indexed) JSONB containment query bounded.
const ITEM_FALLBACK_LOOKBACK_MS = RESPONSES_TTL_SECONDS * 1000;

// Pinned cdb/SWR TTL for the legacy log fallback lookups: the underlying rows
// are immutable, so this only bounds Redis memory, not staleness.
const LEGACY_FALLBACK_TTL_SECONDS = 300;

/**
 * A stored response is a small record of metadata plus ordered lists of item
 * refs; each referenced item is stored once under its own key. Chained turns
 * re-write the same item keys (idempotent, refreshes the TTL) instead of
 * duplicating the conversation, so storage grows with unique items rather
 * than O(N²) across an N-turn conversation.
 */
interface StoredResponseRecord {
	model: string;
	instructions?: string;
	status: "completed" | "incomplete" | "failed";
	incomplete_details?: { reason: string } | null;
	reasoning?: {
		effort: string | null;
		summary: string | null;
		context?: string;
	} | null;
	usage?: Record<string, unknown>;
	created_at?: number;
	inputRefs: string[];
	outputRefs: string[];
}

// Shared prefix of every key written to the responses storage. Tests use it to
// keep this state out of blanket Redis resets (see clearCache in test-utils).
export const RESPONSES_STORAGE_KEY_PREFIX = "responses:";

function itemStorageKey(projectId: string, itemRef: string): string {
	return `${RESPONSES_STORAGE_KEY_PREFIX}item:${projectId}:${itemRef}`;
}

function responseStorageKey(projectId: string, responseId: string): string {
	return `${RESPONSES_STORAGE_KEY_PREFIX}resp:${projectId}:${responseId}`;
}

/**
 * Ref an item by its own id when it has one (gateway-emitted output items and
 * client items with ids), otherwise by a content hash so identical id-less
 * items resent across turns dedup to the same key. item_reference pointers are
 * never keyed by id — that would overwrite the concrete item they point at.
 */
function itemRefFor(item: unknown): string {
	if (item && typeof item === "object") {
		const id = (item as { id?: unknown }).id;
		const type = (item as { type?: unknown }).type;
		if (typeof id === "string" && id && type !== "item_reference") {
			return id;
		}
	}
	return `h_${crypto
		.createHash("sha256")
		.update(JSON.stringify(item))
		.digest("hex")
		.slice(0, 32)}`;
}

/**
 * Resolve an `item_reference` id to the concrete stored item it points at.
 * Tries the item store first, then falls back to a project-scoped lookup over
 * legacy responses stored in log.responsesApiData. Returns null when the item
 * cannot be found.
 */
export async function resolveStoredItem(
	itemId: string,
	projectId: string,
): Promise<Record<string, unknown> | null> {
	try {
		const stored = await getResponsesStorage().get(
			itemStorageKey(projectId, itemId),
		);
		if (stored) {
			return JSON.parse(stored) as Record<string, unknown>;
		}
	} catch (error) {
		logger.warn("Failed to read item from responses storage", {
			itemId,
			error,
		});
	}

	// Fallback: scan recently stored legacy responses for an output/input item
	// with this id. Bounded by project and a recent time window to keep the
	// un-indexed JSONB containment query cheap. Cached with swrWrap + cdb; the
	// cutoff is floored to the UTC day so the SQL bind (and with it the Drizzle
	// cache key) stays stable instead of rotating every millisecond — legacy
	// rows are immutable, so a day of cutoff slack changes nothing.
	try {
		const dayMs = 86_400_000;
		const flooredNow = Math.floor(Date.now() / dayMs) * dayMs;
		const cutoff = new Date(flooredNow - ITEM_FALLBACK_LOOKBACK_MS);
		const match = sql`(${log.responsesApiData} -> 'output' @> ${JSON.stringify([{ id: itemId }])}::jsonb OR ${log.responsesApiData} -> 'input' @> ${JSON.stringify([{ id: itemId }])}::jsonb)`;
		const rows = await swrWrap(
			`respItem:${projectId}:${itemId}`,
			[getTableName(log)],
			async () =>
				await cdb
					.select({ responsesApiData: log.responsesApiData })
					.from(log)
					.where(
						and(
							eq(log.projectId, projectId),
							gte(log.createdAt, cutoff),
							match,
						),
					)
					.orderBy(desc(log.createdAt))
					.limit(1)
					.$withCache({
						tag: `resp-item:${projectId}:${itemId}`,
						autoInvalidate: false,
						config: { ex: LEGACY_FALLBACK_TTL_SECONDS },
					}),
		);

		const data = rows[0]?.responsesApiData as
			{ input?: unknown[]; output?: unknown[] } | undefined;
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
 * Store a completed response for previous_response_id chaining and retrieval
 * via GET /v1/responses/:id. Items are written before the record so a readable
 * record always has its items, and re-writing shared items on chained turns
 * refreshes their TTL alongside the new record.
 */
export async function storeResponse(
	responseId: string,
	data: StoredResponseData,
	projectId: string,
): Promise<void> {
	const entriesByKey = new Map<string, string>();
	const refsFor = (items: unknown[]) =>
		items.map((item) => {
			const ref = itemRefFor(item);
			entriesByKey.set(itemStorageKey(projectId, ref), JSON.stringify(item));
			return ref;
		});
	const inputRefs = refsFor(data.input ?? []);
	const outputRefs = refsFor(data.output ?? []);

	const record: StoredResponseRecord = {
		model: data.model,
		instructions: data.instructions,
		status: data.status,
		incomplete_details: data.incomplete_details ?? null,
		reasoning: data.reasoning ?? null,
		usage: data.usage,
		created_at: data.created_at,
		inputRefs,
		outputRefs,
	};

	try {
		const storage = getResponsesStorage();
		await storage.setMany(
			[...entriesByKey].map(([key, value]) => ({ key, value })),
			RESPONSES_TTL_SECONDS,
		);
		await storage.set(
			responseStorageKey(projectId, responseId),
			JSON.stringify(record),
			RESPONSES_TTL_SECONDS,
		);
	} catch (error) {
		logger.warn("Failed to store response", { responseId, projectId, error });
	}
}

/**
 * Retrieve stored response data by response ID, scoped to the project. Reads
 * the dedicated storage first and falls back to legacy responses persisted in
 * log.responsesApiData before the storage move.
 */
export async function getStoredResponse(
	responseId: string,
	projectId: string,
): Promise<StoredResponseData | null> {
	try {
		const storage = getResponsesStorage();
		const raw = await storage.get(responseStorageKey(projectId, responseId));
		if (raw) {
			const record = JSON.parse(raw) as StoredResponseRecord;
			const refs = [...new Set([...record.inputRefs, ...record.outputRefs])];
			const values = await storage.getMany(
				refs.map((ref) => itemStorageKey(projectId, ref)),
			);
			const itemsByRef = new Map<string, unknown>();
			refs.forEach((ref, i) => {
				const value = values[i];
				if (value !== null && value !== undefined) {
					itemsByRef.set(ref, JSON.parse(value));
				}
			});
			const resolveRefs = (refList: string[]) =>
				refList.flatMap((ref) => {
					if (!itemsByRef.has(ref)) {
						// Items are written with (and re-refreshed alongside) every
						// record that references them, but the storage backend may
						// evict least-recently-used keys under memory pressure —
						// degrade by dropping the missing item rather than failing.
						logger.warn("Stored response item missing from storage", {
							responseId,
							projectId,
							ref,
						});
						return [];
					}
					return [itemsByRef.get(ref)];
				});

			return {
				id: responseId,
				input: resolveRefs(record.inputRefs),
				output: resolveRefs(record.outputRefs),
				instructions: record.instructions,
				model: record.model ?? "",
				status: record.status ?? "completed",
				incomplete_details: record.incomplete_details ?? null,
				reasoning: record.reasoning ?? null,
				usage: record.usage,
				created_at: record.created_at,
			};
		}
	} catch (error) {
		logger.warn("Failed to read response from responses storage", {
			responseId,
			projectId,
			error,
		});
	}

	// Legacy fallback: responses stored in log.responsesApiData before the move
	// to dedicated storage. Cached with swrWrap + a pinned cdb entry — these
	// rows are immutable once written, so a fixed TTL is safe and chained
	// turns that keep resolving the same legacy response skip the DB.
	try {
		const rows = await swrWrap(
			`respLegacy:${projectId}:${responseId}`,
			[getTableName(log)],
			async () =>
				await cdb
					.select({ responsesApiData: log.responsesApiData })
					.from(log)
					.where(and(eq(log.id, responseId), eq(log.projectId, projectId)))
					.limit(1)
					.$withCache({
						tag: `resp-legacy:${projectId}:${responseId}`,
						autoInvalidate: false,
						config: { ex: LEGACY_FALLBACK_TTL_SECONDS },
					}),
		);

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
			incomplete_details?: { reason: string } | null;
			reasoning?: {
				effort: string | null;
				summary: string | null;
				context?: string;
			} | null;
			usage?: Record<string, unknown>;
			created_at?: number;
		};

		return {
			id: responseId,
			input: data.input,
			output: data.output,
			instructions: data.instructions,
			model: data.model ?? "",
			status: data.status ?? "completed",
			incomplete_details: data.incomplete_details ?? null,
			reasoning: data.reasoning ?? null,
			usage: data.usage,
			created_at: data.created_at,
		};
	} catch {
		return null;
	}
}
