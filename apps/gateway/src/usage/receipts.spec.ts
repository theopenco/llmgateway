import { randomUUID } from "node:crypto";

import { describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "@/test-utils/test-helpers.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import type { UsageReceipt } from "./store.js";

const TOKEN = "receipt-token";

function decodeReceipt(header: string | null): UsageReceipt {
	expect(header).toBeTruthy();
	return JSON.parse(
		Buffer.from(header!, "base64url").toString("utf8"),
	) as UsageReceipt;
}

// Receipts live in storage Redis, which outlives a run; keep operation IDs unique.
const RUN = randomUUID().slice(0, 8);

function scoped(id: string): string {
	return id.startsWith("op-") ? `${RUN}-${id}` : id;
}

function receiptHeaders(operationId: string): Record<string, string> {
	return {
		"Content-Type": "application/json",
		Authorization: `Bearer ${TOKEN}`,
		"x-no-fallback": "true",
		"x-llmgateway-usage-contract": "1",
		"x-llmgateway-operation-id": scoped(operationId),
	};
}

async function getReceipt(id: string): Promise<Response> {
	return await app.request(`/v1/usage/receipts/${scoped(id)}`, {
		headers: { Authorization: `Bearer ${TOKEN}` },
	});
}

describe("usage receipts", () => {
	const harness = createGatewayApiTestHarness();

	async function seedKeys() {
		await db.insert(tables.apiKey).values({
			id: "receipt-token-id",
			...hashApiKeyForStorage(TOKEN),
			projectId: "project-id",
			description: "Receipt key",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: "receipt-provider-key",
			...encryptProviderKeyForStorage(
				"receipt-openai-key",
				"receipt-provider-key",
				"org-id",
			),
			provider: "openai",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
	}

	test("a chat completion carries a final receipt matching usage.cost", async () => {
		await seedKeys();
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: receiptHeaders("op-chat-1"),
			body: JSON.stringify({
				model: "openai/gpt-4o-mini",
				messages: [{ role: "user", content: "receipt chat" }],
			}),
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		const receipt = decodeReceipt(res.headers.get("x-llmgateway-usage"));
		expect(res.headers.get("x-llmgateway-receipt-id")).toBe(receipt.receiptId);
		expect(receipt).toMatchObject({
			v: 1,
			operationId: scoped("op-chat-1"),
			operation: "chat.completions",
			model: "openai/gpt-4o-mini",
			state: "final",
			pricingVersion: "llmgateway-list-v1",
		});
		expect(Number(receipt.costUsd)).toBeGreaterThan(0);
		expect(Number(receipt.costUsd)).toBeCloseTo(json.usage.cost, 12);
		expect(receipt.usage.input_tokens).toBeGreaterThan(0);

		for (const id of [receipt.receiptId, "op-chat-1"]) {
			const lookup = await getReceipt(id);
			expect(lookup.status).toBe(200);
			expect(await lookup.json()).toEqual(receipt);
		}
	});

	test("a streamed chat completion settles its receipt when the stream ends", async () => {
		await seedKeys();
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: receiptHeaders("op-stream-1"),
			body: JSON.stringify({
				model: "openai/gpt-4o-mini",
				stream: true,
				messages: [{ role: "user", content: "receipt stream" }],
			}),
		});
		expect(res.status).toBe(200);
		const receiptId = res.headers.get("x-llmgateway-receipt-id");
		expect(receiptId).toBeTruthy();
		expect(res.headers.get("x-llmgateway-usage")).toBeNull();
		await res.text();
		await waitForLogs(1);

		const lookup = await getReceipt("op-stream-1");
		expect(lookup.status).toBe(200);
		const receipt = (await lookup.json()) as UsageReceipt;
		expect(receipt).toMatchObject({
			receiptId,
			state: "final",
			model: "openai/gpt-4o-mini",
		});
		expect(Number(receipt.costUsd)).toBeGreaterThan(0);
	});

	test("embeddings get usage.cost in the body and the header", async () => {
		await seedKeys();
		const res = await app.request("/v1/embeddings", {
			method: "POST",
			headers: receiptHeaders("op-embed-1"),
			body: JSON.stringify({
				model: "openai/text-embedding-3-small",
				input: "receipt embeddings",
			}),
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		const receipt = decodeReceipt(res.headers.get("x-llmgateway-usage"));
		expect(receipt).toMatchObject({ operation: "embeddings", state: "final" });
		expect(json.usage.cost).toBe(Number(receipt.costUsd));
	});

	test("binary speech replies carry the receipt in the header", async () => {
		await seedKeys();
		await db.insert(tables.providerKey).values({
			id: "receipt-google-key",
			...encryptProviderKeyForStorage(
				"receipt-google-key-value",
				"receipt-google-key",
				"org-id",
			),
			provider: "google-ai-studio",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
		const res = await app.request("/v1/audio/speech", {
			method: "POST",
			headers: receiptHeaders("op-speech-1"),
			body: JSON.stringify({
				model: "gemini-2.5-flash-preview-tts",
				input: "Hello there",
				voice: "Kore",
			}),
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("audio/wav");
		const bytes = Buffer.from(await res.arrayBuffer());
		expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
		const receipt = decodeReceipt(res.headers.get("x-llmgateway-usage"));
		expect(receipt).toMatchObject({
			operation: "audio.speech",
			model: "gemini-2.5-flash-preview-tts",
			state: "final",
		});
		expect(Number(receipt.costUsd)).toBeGreaterThan(0);
	});

	test("a video receipt stays pending until the job is billed", async () => {
		await seedKeys();
		await db.insert(tables.providerKey).values({
			id: "receipt-atlascloud-key",
			...encryptProviderKeyForStorage(
				"receipt-atlascloud-key-value",
				"receipt-atlascloud-key",
				"org-id",
			),
			provider: "atlascloud",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
		const res = await app.request("/v1/videos", {
			method: "POST",
			headers: receiptHeaders("op-video-1"),
			body: JSON.stringify({
				model: "atlascloud/kling-v3-0",
				prompt: "A city street reflected in rain at night",
				size: "1280x720",
				seconds: 5,
				audio: false,
			}),
		});
		expect(res.status).toBe(200);
		const created = await res.json();
		expect(res.headers.get("x-llmgateway-usage")).toBeNull();

		const pending = await getReceipt("op-video-1");
		expect(await pending.json()).toMatchObject({
			operation: "videos",
			state: "pending",
			costUsd: null,
			resourceId: created.id,
		});

		await db
			.update(tables.videoJob)
			.set({ status: "completed", resultLoggedAt: new Date(), cost: 0.5 })
			.where(eq(tables.videoJob.id, created.id));
		const final = await getReceipt("op-video-1");
		expect(await final.json()).toMatchObject({
			state: "final",
			costUsd: "0.5",
			resourceId: created.id,
		});
	});

	test("a request rejected before any provider is final at zero", async () => {
		await seedKeys();
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: receiptHeaders("op-rejected-1"),
			body: JSON.stringify({
				model: "receipt-model-that-does-not-exist",
				messages: [{ role: "user", content: "receipt rejected" }],
			}),
		});
		expect(res.status).toBeGreaterThanOrEqual(400);
		const receipt = decodeReceipt(res.headers.get("x-llmgateway-usage"));
		expect(receipt).toMatchObject({ state: "final", costUsd: "0" });

		// Nothing was served, so the operation ID may be retried.
		const retry = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: receiptHeaders("op-rejected-1"),
			body: JSON.stringify({
				model: "openai/gpt-4o-mini",
				messages: [{ role: "user", content: "receipt retry" }],
			}),
		});
		expect(retry.status).toBe(200);
	});

	test("a served operation ID cannot be reused", async () => {
		await seedKeys();
		const body = JSON.stringify({
			model: "openai/gpt-4o-mini",
			messages: [{ role: "user", content: "receipt reuse" }],
		});
		const first = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: receiptHeaders("op-reuse-1"),
			body,
		});
		expect(first.status).toBe(200);
		const second = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: receiptHeaders("op-reuse-1"),
			body,
		});
		expect(second.status).toBe(409);
	});

	test("requests without the contract header get no receipt", async () => {
		await seedKeys();
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${TOKEN}`,
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "openai/gpt-4o-mini",
				messages: [{ role: "user", content: "receipt none" }],
			}),
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("x-llmgateway-receipt-id")).toBeNull();
	});

	test("an unsupported contract version is refused", async () => {
		await seedKeys();
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				...receiptHeaders("op-version-1"),
				"x-llmgateway-usage-contract": "2",
			},
			body: JSON.stringify({
				model: "openai/gpt-4o-mini",
				messages: [{ role: "user", content: "receipt version" }],
			}),
		});
		expect(res.status).toBe(400);
	});

	test("an unknown receipt is a 404", async () => {
		await seedKeys();
		const res = await getReceipt("op-unknown-1");
		expect(res.status).toBe(404);
	});
});
