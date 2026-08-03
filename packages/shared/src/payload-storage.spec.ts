import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
	buildPayloadKey,
	ensurePayloadStorageBucket,
	getLogPayload,
	hasLogPayload,
	isPayloadStorageEnabled,
	mapWithConcurrency,
	putLogPayload,
	splitLogPayload,
} from "./payload-storage.js";

const PAYLOAD_ENV_KEYS = [
	"PAYLOAD_STORAGE_S3_BUCKET",
	"PAYLOAD_STORAGE_S3_ENDPOINT",
	"PAYLOAD_STORAGE_S3_REGION",
	"PAYLOAD_STORAGE_S3_ACCESS_KEY_ID",
	"PAYLOAD_STORAGE_S3_SECRET_ACCESS_KEY",
	"PAYLOAD_STORAGE_S3_FORCE_PATH_STYLE",
	"PAYLOAD_STORAGE_S3_PREFIX",
] as const;

function snapshotEnv(): Record<string, string | undefined> {
	return Object.fromEntries(
		PAYLOAD_ENV_KEYS.map((key) => [key, process.env[key]]),
	);
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
	for (const key of PAYLOAD_ENV_KEYS) {
		const value = snapshot[key];
		if (value === undefined) {
			Reflect.deleteProperty(process.env, key);
		} else {
			process.env[key] = value;
		}
	}
}

function setMinioEnv(): void {
	process.env.PAYLOAD_STORAGE_S3_BUCKET = "llmgateway-payloads";
	process.env.PAYLOAD_STORAGE_S3_ENDPOINT = "http://localhost:9000";
	process.env.PAYLOAD_STORAGE_S3_REGION = "us-east-1";
	process.env.PAYLOAD_STORAGE_S3_ACCESS_KEY_ID = "minioadmin";
	process.env.PAYLOAD_STORAGE_S3_SECRET_ACCESS_KEY = "minioadmin";
	process.env.PAYLOAD_STORAGE_S3_FORCE_PATH_STYLE = "true";
	delete process.env.PAYLOAD_STORAGE_S3_PREFIX;
}

describe("payload-storage", () => {
	const envSnapshot = snapshotEnv();

	afterAll(() => {
		restoreEnv(envSnapshot);
	});

	describe("isPayloadStorageEnabled", () => {
		test("is disabled without a bucket and enabled with one", () => {
			delete process.env.PAYLOAD_STORAGE_S3_BUCKET;
			expect(isPayloadStorageEnabled()).toBe(false);

			process.env.PAYLOAD_STORAGE_S3_BUCKET = "   ";
			expect(isPayloadStorageEnabled()).toBe(false);

			process.env.PAYLOAD_STORAGE_S3_BUCKET = "some-bucket";
			expect(isPayloadStorageEnabled()).toBe(true);
		});
	});

	describe("buildPayloadKey", () => {
		test("builds org/project scoped keys with optional prefix", () => {
			delete process.env.PAYLOAD_STORAGE_S3_PREFIX;
			expect(buildPayloadKey("org-1", "proj-1", "log-1")).toBe(
				"logs/org-1/proj-1/log-1.json.zst",
			);

			process.env.PAYLOAD_STORAGE_S3_PREFIX = "tenant-a/";
			expect(buildPayloadKey("org-1", "proj-1", "log-1")).toBe(
				"tenant-a/logs/org-1/proj-1/log-1.json.zst",
			);
			delete process.env.PAYLOAD_STORAGE_S3_PREFIX;
		});
	});

	describe("hasLogPayload", () => {
		test("detects rows with and without payload fields", () => {
			expect(hasLogPayload({ duration: 100 })).toBe(false);
			expect(hasLogPayload({ messages: null, content: null })).toBe(false);
			expect(hasLogPayload({ content: "hi" })).toBe(true);
			expect(
				hasLogPayload({ messages: [{ role: "user", content: "x" }] }),
			).toBe(true);
			// responsesApiData is not a payload field (kept in PG for the legacy
			// Responses API fallbacks).
			expect(hasLogPayload({ responsesApiData: { output: [] } })).toBe(false);
		});
	});

	describe("splitLogPayload", () => {
		test("keeps full values in the payload and truncated previews", () => {
			const longContent = "a".repeat(5000);
			const longMessage = "b".repeat(3000);
			const { payload, previewColumns } = splitLogPayload({
				messages: [
					{ role: "system", content: "be helpful" },
					{ role: "user", content: longMessage },
				],
				content: longContent,
				reasoningContent: null,
				tools: [
					{
						type: "function",
						function: {
							name: "get_weather",
							description: "Get the weather",
							parameters: { type: "object", properties: { q: {} } },
						},
					},
				],
				toolChoice: "auto",
				toolResults: [{ output: "big tool output" }],
				rawRequest: { body: "debug" },
				duration: 5,
			});

			expect(payload.content).toBe(longContent);
			expect(payload.messages).toEqual([
				{ role: "system", content: "be helpful" },
				{ role: "user", content: longMessage },
			]);
			expect(payload.toolResults).toEqual([{ output: "big tool output" }]);
			expect(payload.rawRequest).toEqual({ body: "debug" });
			// Non-payload scalar columns are not part of the blob.
			expect(payload.duration).toBeUndefined();

			const previewContent = previewColumns.content as string;
			expect(previewContent.length).toBeLessThan(longContent.length);
			expect(previewContent).toContain("[truncated]");

			const previewMessages = previewColumns.messages as Array<{
				role: string;
				content: string;
			}>;
			expect(previewMessages[0]).toEqual({
				role: "system",
				content: "be helpful",
			});
			expect(previewMessages[1].role).toBe("user");
			expect(previewMessages[1].content.length).toBeLessThan(
				longMessage.length,
			);

			// Tool previews keep identity but drop parameter schemas.
			expect(previewColumns.tools).toEqual([
				{
					type: "function",
					function: { name: "get_weather", description: "Get the weather" },
				},
			]);
			expect(previewColumns.toolChoice).toBe("auto");

			// Detail-only fields preview as null.
			expect(previewColumns.toolResults).toBeNull();
			expect(previewColumns.rawRequest).toBeNull();
		});

		test("replaces base64 content with placeholders", () => {
			const { previewColumns } = splitLogPayload({
				content: `data:image/png;base64,${"x".repeat(5000)}`,
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: "what is this?" },
							{
								type: "image_url",
								image_url: {
									url: `data:image/png;base64,${"y".repeat(20000)}`,
								},
							},
						],
					},
				],
			});

			expect(previewColumns.content).toBe("[image_generated]");
			const previewMessages = previewColumns.messages as Array<{
				content: Array<Record<string, unknown>>;
			}>;
			expect(previewMessages[0].content[0]).toEqual({
				type: "text",
				text: "what is this?",
			});
			expect(previewMessages[0].content[1]).toEqual({
				type: "image_url",
				content: "[omitted]",
			});
		});

		test("caps very long conversations to head and tail", () => {
			const messages = Array.from({ length: 500 }, (_, i) => ({
				role: i % 2 === 0 ? "user" : "assistant",
				content: `turn ${i}: ${"z".repeat(900)}`,
			}));
			const { payload, previewColumns } = splitLogPayload({ messages });

			expect((payload.messages as unknown[]).length).toBe(500);
			const preview = previewColumns.messages as Array<{ content: string }>;
			expect(preview.length).toBe(13);
			expect(preview[0].content).toContain("turn 0");
			expect(preview[2].content).toContain("messages truncated");
			expect(preview[12].content).toContain("turn 499");
		});
	});

	describe("mapWithConcurrency", () => {
		test("maps all items preserving order", async () => {
			const items = Array.from({ length: 20 }, (_, i) => i);
			const result = await mapWithConcurrency(items, 4, async (item) => {
				await new Promise((resolve) => {
					setTimeout(resolve, (20 - item) % 5);
				});
				return item * 2;
			});
			expect(result).toEqual(items.map((i) => i * 2));
		});

		test("rejects with the first error", async () => {
			await expect(
				mapWithConcurrency([1, 2, 3], 2, async (item) => {
					if (item === 2) {
						throw new Error("boom");
					}
					return item;
				}),
			).rejects.toThrow("boom");
		});
	});

	describe("minio roundtrip", () => {
		beforeAll(async () => {
			setMinioEnv();
			await ensurePayloadStorageBucket();
		});

		afterAll(() => {
			restoreEnv(envSnapshot);
		});

		test("uploads, downloads and decompresses a payload", async () => {
			const key = buildPayloadKey("test-org", "test-project", randomUUID());
			const payload = {
				messages: [{ role: "user", content: "hello minio ".repeat(1000) }],
				content: "response body",
				rawRequest: { headers: { "x-debug": "true" } },
			};

			const returnedKey = await putLogPayload(key, payload);
			expect(returnedKey).toBe(key);

			const fetched = await getLogPayload(key);
			expect(fetched).toEqual(payload);
		});

		test("returns null for a missing object", async () => {
			const fetched = await getLogPayload(
				buildPayloadKey("test-org", "test-project", `missing-${randomUUID()}`),
			);
			expect(fetched).toBeNull();
		});

		test("returns null when payload storage is disabled", async () => {
			const key = buildPayloadKey("test-org", "test-project", randomUUID());
			await putLogPayload(key, { content: "still there" });

			const bucket = process.env.PAYLOAD_STORAGE_S3_BUCKET;
			delete process.env.PAYLOAD_STORAGE_S3_BUCKET;
			try {
				expect(await getLogPayload(key)).toBeNull();
			} finally {
				process.env.PAYLOAD_STORAGE_S3_BUCKET = bucket;
			}
		});
	});
});
