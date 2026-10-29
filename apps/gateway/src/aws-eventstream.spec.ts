import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { buildAwsEventStreamMessage } from "./test-utils/mock-openai-server.js";
import { waitForLogs } from "./test-utils/test-helpers.js";

function combine(...frames: Uint8Array[]): Uint8Array {
	const buffer = new Uint8Array(
		frames.reduce((size, frame) => size + frame.length, 0),
	);
	let offset = 0;
	for (const frame of frames) {
		buffer.set(frame, offset);
		offset += frame.length;
	}
	return buffer;
}

function mockUpstream(chunks: Uint8Array[]) {
	let reads = 0;
	const cancel = vi.fn();
	const body = new ReadableStream<Uint8Array>(
		{
			pull(controller) {
				const chunk = chunks[reads++];
				if (chunk) {
					controller.enqueue(chunk);
				} else {
					controller.close();
				}
			},
			cancel,
		},
		{ highWaterMark: 0 },
	);
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		new Response(body, {
			headers: { "content-type": "application/vnd.amazon.eventstream" },
		}),
	);
	return { cancel, reads: () => reads };
}

async function requestStream(): Promise<string> {
	const res = await app.request("/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: "Bearer test-token",
			"x-no-fallback": "true",
		},
		body: JSON.stringify({
			model: "aws-bedrock/claude-opus-4-6",
			messages: [{ role: "user", content: "hi" }],
			stream: true,
		}),
	});
	expect(res.status).toBe(200);
	return await res.text();
}

function expectSingleErrorBeforeDone(text: string) {
	expect(text.match(/event: error/g)).toHaveLength(1);
	expect(text.match(/data: \[DONE\]/g)).toHaveLength(1);
	expect(text.indexOf("event: error")).toBeLessThan(
		text.indexOf("data: [DONE]"),
	);
	expect(
		text
			.trim()
			.split(/\r?\n\r?\n/)
			.at(-1),
	).toContain("data: [DONE]");
}

describe("AWS EventStream framing", () => {
	createGatewayApiTestHarness();

	beforeEach(async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("test-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			...encryptProviderKeyForStorage(
				"test-provider-key",
				"provider-key-id",
				"org-id",
			),
			provider: "aws-bedrock",
			organizationId: "org-id",
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	it.each(["undersized", "oversized headers", "header field overrun"])(
		"aborts %s without reading more upstream bytes",
		async (kind) => {
			const invalid = new Uint8Array(18);
			const view = new DataView(invalid.buffer);
			if (kind === "oversized headers") {
				view.setUint32(0, 18);
				view.setUint32(4, 3);
			} else if (kind === "header field overrun") {
				view.setUint32(0, 18);
				view.setUint32(4, 2);
				invalid[12] = 3;
			}
			const upstream = mockUpstream([invalid, new Uint8Array(16)]);
			const text = await requestStream();
			expectSingleErrorBeforeDone(text);
			expect(text).toContain("malformed_event_stream");
			expect(upstream.cancel).toHaveBeenCalledOnce();
			expect(upstream.reads()).toBe(1);
			const [log] = await waitForLogs(1);
			expect(log.finishReason).toBe("upstream_error");
			expect(log.errorDetails?.statusCode).toBe(502);
		},
	);

	it.each([16, 2048])(
		"delivers a valid prefix before rejecting a %i-byte tail",
		async (tailLength) => {
			vi.stubEnv("MAX_STREAMING_BUFFER_MB", "0.001");
			mockUpstream([
				combine(
					buildAwsEventStreamMessage("contentBlockDelta", {
						delta: { text: "hello" },
						contentBlockIndex: 0,
					}),
					new Uint8Array(tailLength),
				),
			]);
			const text = await requestStream();
			expectSingleErrorBeforeDone(text);
			expect(text).toContain("malformed_event_stream");
			expect(text).toContain('"content":"hello"');
			expect(text.indexOf('"content":"hello"')).toBeLessThan(
				text.indexOf("event: error"),
			);
		},
	);

	it("preserves a provider exception without emitting errors after DONE", async () => {
		mockUpstream([
			combine(
				buildAwsEventStreamMessage("modelStreamErrorException", {
					message: "upstream failed",
					originalStatusCode: 503,
				}),
				new Uint8Array(16),
			),
		]);
		const text = await requestStream();
		expectSingleErrorBeforeDone(text);
		expect(text).toContain("modelStreamErrorException");
		expect(text).not.toContain("malformed_event_stream");
		const [log] = await waitForLogs(1);
		expect(log.errorDetails?.statusCode).toBe(503);
	});

	it("caps an incomplete binary frame using the streaming buffer limit", async () => {
		vi.stubEnv("MAX_STREAMING_BUFFER_MB", "0.001");
		try {
			const incomplete = new Uint8Array(2048);
			new DataView(incomplete.buffer).setUint32(0, 0xffffffff);
			const upstream = mockUpstream([incomplete, incomplete]);
			const text = await requestStream();
			expectSingleErrorBeforeDone(text);
			expect(text).toContain("buffer_overflow");
			expect(upstream.cancel).toHaveBeenCalledOnce();
			expect(upstream.reads()).toBe(1);
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("waits for incomplete frames and closes a valid stream normally", async () => {
		const delta = buildAwsEventStreamMessage("contentBlockDelta", {
			delta: { text: "hello" },
			contentBlockIndex: 0,
		});
		mockUpstream([
			delta.slice(0, 7),
			delta.slice(7),
			buildAwsEventStreamMessage("messageStop", { stopReason: "end_turn" }),
		]);
		const text = await requestStream();
		expect(text).toContain('"content":"hello"');
		expect(text).not.toContain("event: error");
		expect(text.match(/data: \[DONE\]/g)).toHaveLength(1);
	});
});
