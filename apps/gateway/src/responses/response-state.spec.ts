import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
	storeResponse,
	getStoredResponse,
	resolveStoredItem,
	RESPONSES_TTL_SECONDS,
} from "./tools/response-state.js";
import {
	getResponsesStorage,
	setResponsesStorageForTesting,
	type ResponsesStorage,
} from "./tools/response-storage.js";

const dbSelectLimit = vi.fn().mockResolvedValue([]);
vi.mock("@llmgateway/db", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	// The legacy fallbacks query through the cached client and end the chain
	// with .$withCache(config), which is what resolves the rows.
	const resolveRows = {
		$withCache: (...args: unknown[]) => dbSelectLimit(...args),
	};
	return {
		...actual,
		cdb: {
			select: vi.fn().mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockReturnValue(resolveRows),
						orderBy: vi.fn().mockReturnValue({
							limit: vi.fn().mockReturnValue(resolveRows),
						}),
					}),
				}),
			}),
		},
	};
});

vi.mock("@llmgateway/cache", () => ({
	redisClient: {},
	storageRedisClient: {},
	swrWrap: async <T>(
		_key: string,
		_tables: string[],
		fetcher: () => Promise<T>,
	) => await fetcher(),
}));

vi.mock("@llmgateway/logger", () => ({
	logger: {
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

class MemoryResponsesStorage implements ResponsesStorage {
	public store = new Map<string, string>();
	public writes = 0;

	public async set(key: string, value: string): Promise<void> {
		this.writes++;
		this.store.set(key, value);
	}

	public async setMany(
		entries: { key: string; value: string }[],
	): Promise<void> {
		for (const entry of entries) {
			this.writes++;
			this.store.set(entry.key, entry.value);
		}
	}

	public async get(key: string): Promise<string | null> {
		return this.store.get(key) ?? null;
	}

	public async getMany(keys: string[]): Promise<(string | null)[]> {
		return keys.map((key) => this.store.get(key) ?? null);
	}
}

let memory: MemoryResponsesStorage;

beforeEach(() => {
	memory = new MemoryResponsesStorage();
	setResponsesStorageForTesting(memory);
	dbSelectLimit.mockResolvedValue([]);
});

afterEach(() => {
	setResponsesStorageForTesting(undefined);
});

const userMessage = { role: "user", content: "hello" };
const outputMessage = {
	type: "message",
	id: "msg_1",
	role: "assistant",
	content: [{ type: "output_text", text: "hi there" }],
};

describe("storeResponse / getStoredResponse", () => {
	it("round-trips a stored response through the storage backend", async () => {
		await storeResponse(
			"resp_1",
			{
				id: "resp_1",
				input: [userMessage],
				output: [outputMessage],
				instructions: "be nice",
				model: "openai/gpt-5.5",
				status: "completed",
				usage: { total_tokens: 10 },
				created_at: 1234,
			},
			"project_1",
		);

		const stored = await getStoredResponse("resp_1", "project_1");
		expect(stored).not.toBeNull();
		expect(stored!.input).toEqual([userMessage]);
		expect(stored!.output).toEqual([outputMessage]);
		expect(stored!.instructions).toBe("be nice");
		expect(stored!.model).toBe("openai/gpt-5.5");
		expect(stored!.status).toBe("completed");
		expect(stored!.usage).toEqual({ total_tokens: 10 });
		expect(stored!.created_at).toBe(1234);
	});

	it("is scoped by project", async () => {
		await storeResponse(
			"resp_1",
			{
				id: "resp_1",
				input: [userMessage],
				output: [outputMessage],
				model: "openai/gpt-5.5",
				status: "completed",
			},
			"project_1",
		);

		expect(await getStoredResponse("resp_1", "project_2")).toBeNull();
	});

	it("stores each unique item once across chained turns", async () => {
		const turn2User = { role: "user", content: "and then?" };
		const turn2Output = {
			type: "message",
			id: "msg_2",
			role: "assistant",
			content: [{ type: "output_text", text: "the end" }],
		};

		await storeResponse(
			"resp_1",
			{
				id: "resp_1",
				input: [userMessage],
				output: [outputMessage],
				model: "openai/gpt-5.5",
				status: "completed",
			},
			"project_1",
		);
		const keysAfterTurn1 = memory.store.size;

		// Chained turn: full reconstructed history + new items, as the POST
		// handler builds it from a previous_response_id.
		await storeResponse(
			"resp_2",
			{
				id: "resp_2",
				input: [userMessage, outputMessage, turn2User],
				output: [turn2Output],
				model: "openai/gpt-5.5",
				status: "completed",
			},
			"project_1",
		);

		// Only the new record + the two new items appear; the shared history
		// items dedup onto their existing keys instead of being stored again.
		expect(memory.store.size).toBe(keysAfterTurn1 + 3);

		const stored = await getStoredResponse("resp_2", "project_1");
		expect(stored!.input).toEqual([userMessage, outputMessage, turn2User]);
		expect(stored!.output).toEqual([turn2Output]);
	});

	it("dedups identical id-less items via content hashing", async () => {
		await storeResponse(
			"resp_1",
			{
				id: "resp_1",
				input: [userMessage, userMessage],
				output: [],
				model: "openai/gpt-5.5",
				status: "completed",
			},
			"project_1",
		);

		// One record + one item key despite the item appearing twice; order and
		// duplicates are still preserved on read via the record's ref list.
		expect(memory.store.size).toBe(2);
		const stored = await getStoredResponse("resp_1", "project_1");
		expect(stored!.input).toEqual([userMessage, userMessage]);
	});

	it("never keys an item_reference by its id", async () => {
		const reference = { type: "item_reference", id: "msg_1" };
		await storeResponse(
			"resp_1",
			{
				id: "resp_1",
				input: [outputMessage, reference],
				output: [],
				model: "openai/gpt-5.5",
				status: "completed",
			},
			"project_1",
		);

		// The concrete msg_1 item must survive under its id; the reference gets
		// a content-hash key instead of overwriting it.
		expect(
			JSON.parse(memory.store.get("responses:item:project_1:msg_1")!),
		).toEqual(outputMessage);
		const stored = await getStoredResponse("resp_1", "project_1");
		expect(stored!.input).toEqual([outputMessage, reference]);
	});

	it("preserves incomplete_details and reasoning metadata", async () => {
		await storeResponse(
			"resp_1",
			{
				id: "resp_1",
				input: [userMessage],
				output: [],
				model: "openai/gpt-5.5",
				status: "incomplete",
				incomplete_details: { reason: "max_output_tokens" },
				reasoning: { effort: "high", summary: null, context: "ctx" },
			},
			"project_1",
		);

		const stored = await getStoredResponse("resp_1", "project_1");
		expect(stored!.status).toBe("incomplete");
		expect(stored!.incomplete_details).toEqual({
			reason: "max_output_tokens",
		});
		expect(stored!.reasoning).toEqual({
			effort: "high",
			summary: null,
			context: "ctx",
		});
	});

	it("falls back to legacy log.responsesApiData rows on a storage miss", async () => {
		dbSelectLimit.mockResolvedValueOnce([
			{
				responsesApiData: {
					input: [userMessage],
					output: [outputMessage],
					instructions: "legacy",
					model: "openai/gpt-4o",
					status: "completed",
				},
			},
		]);

		const stored = await getStoredResponse("resp_legacy", "project_1");
		expect(stored).not.toBeNull();
		expect(stored!.input).toEqual([userMessage]);
		expect(stored!.output).toEqual([outputMessage]);
		expect(stored!.instructions).toBe("legacy");
	});

	it("returns null when neither storage nor the legacy fallback has the response", async () => {
		expect(await getStoredResponse("resp_missing", "project_1")).toBeNull();
	});
});

describe("resolveStoredItem", () => {
	it("resolves items directly from the item store", async () => {
		await storeResponse(
			"resp_1",
			{
				id: "resp_1",
				input: [],
				output: [outputMessage],
				model: "openai/gpt-5.5",
				status: "completed",
			},
			"project_1",
		);

		expect(await resolveStoredItem("msg_1", "project_1")).toEqual(
			outputMessage,
		);
		expect(await resolveStoredItem("msg_1", "project_2")).toBeNull();
	});
});

describe("getResponsesStorage", () => {
	it("returns the Redis driver by default and throws on unknown drivers", () => {
		setResponsesStorageForTesting(undefined);
		expect(getResponsesStorage()).toBeDefined();

		vi.stubEnv("RESPONSES_STORAGE_DRIVER", "gcs");
		try {
			expect(() => getResponsesStorage()).toThrow(
				"Unknown RESPONSES_STORAGE_DRIVER: gcs",
			);
		} finally {
			vi.unstubAllEnvs();
		}
	});
});

describe("RESPONSES_TTL_SECONDS", () => {
	it("is 30 days", () => {
		expect(RESPONSES_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
	});
});
