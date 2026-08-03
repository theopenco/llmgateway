import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { db, eq, tables } from "@llmgateway/db";
import {
	ensurePayloadStorageBucket,
	getLogPayload,
} from "@llmgateway/shared/payload-storage";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "./test-utils/test-helpers.js";

const PAYLOAD_ENV_KEYS = [
	"PAYLOAD_STORAGE_S3_BUCKET",
	"PAYLOAD_STORAGE_S3_ENDPOINT",
	"PAYLOAD_STORAGE_S3_REGION",
	"PAYLOAD_STORAGE_S3_ACCESS_KEY_ID",
	"PAYLOAD_STORAGE_S3_SECRET_ACCESS_KEY",
	"PAYLOAD_STORAGE_S3_FORCE_PATH_STYLE",
	"PAYLOAD_STORAGE_S3_PREFIX",
] as const;

// Full-flow test of payload offloading against the local MinIO from
// docker-compose: gateway (mock provider upstream) → log queue → worker
// offload+insert → blob in object storage + previews in Postgres. Runs as a
// normal spec (no real provider needed); the same wiring serves prod GCS via
// its S3-interoperability API.
describe("payload storage offloading", () => {
	const harness = createGatewayApiTestHarness();
	const envSnapshot = Object.fromEntries(
		PAYLOAD_ENV_KEYS.map((key) => [key, process.env[key]]),
	);

	beforeAll(async () => {
		process.env.PAYLOAD_STORAGE_S3_BUCKET = "llmgateway-payloads";
		process.env.PAYLOAD_STORAGE_S3_ENDPOINT = "http://localhost:9000";
		process.env.PAYLOAD_STORAGE_S3_REGION = "us-east-1";
		process.env.PAYLOAD_STORAGE_S3_ACCESS_KEY_ID = "minioadmin";
		process.env.PAYLOAD_STORAGE_S3_SECRET_ACCESS_KEY = "minioadmin";
		process.env.PAYLOAD_STORAGE_S3_FORCE_PATH_STYLE = "true";
		delete process.env.PAYLOAD_STORAGE_S3_PREFIX;
		await ensurePayloadStorageBucket();
	});

	afterAll(() => {
		for (const key of PAYLOAD_ENV_KEYS) {
			const value = envSnapshot[key];
			if (value === undefined) {
				Reflect.deleteProperty(process.env, key);
			} else {
				process.env[key] = value;
			}
		}
	});

	async function setupKeys() {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "llmgateway",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
	}

	async function requestChatCompletion(userContent: string) {
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "llmgateway/custom",
				messages: [{ role: "user", content: userContent }],
			}),
		});
		expect(res.status).toBe(200);
		return (await res.json()) as {
			choices: Array<{ message: { content: string } }>;
		};
	}

	test("offloads the payload to object storage and keeps previews in the row", async () => {
		await setupKeys();

		// Long enough that the stored message preview must be truncated while
		// the blob keeps the full original.
		const userContent = `payload offload check ${"lorem ipsum ".repeat(200)}`;
		const json = await requestChatCompletion(userContent);
		const responseContent = json.choices[0].message.content;

		const logs = await waitForLogs(1);
		const row = logs[0];

		expect(row.payloadRef).toBe(`logs/org-id/project-id/${row.id}.json.zst`);

		// Previews replaced the payload columns.
		const previewMessages = row.messages as Array<{
			role: string;
			content: string;
		}>;
		expect(previewMessages[0].role).toBe("user");
		expect(previewMessages[0].content.length).toBeLessThan(userContent.length);
		expect(previewMessages[0].content).toContain("[truncated]");

		// The blob holds the full original payload.
		const payload = await getLogPayload(row.payloadRef!);
		expect(payload).toBeTruthy();
		expect(payload!.messages).toEqual([{ role: "user", content: userContent }]);
		expect(payload!.content).toBe(responseContent);
	});

	test("skips the blob for rows stripped by retention", async () => {
		await setupKeys();
		await db
			.update(tables.organization)
			.set({ retentionLevel: "none" })
			.where(eq(tables.organization.id, "org-id"));

		await requestChatCompletion("retention none payload check");

		const logs = await waitForLogs(1);
		const row = logs[0];

		expect(row.payloadRef).toBeNull();
		expect(row.messages).toBeNull();
		expect(row.content).toBeNull();
	});

	test("keeps payloads inline when payload storage is disabled", async () => {
		await setupKeys();

		const bucket = process.env.PAYLOAD_STORAGE_S3_BUCKET;
		delete process.env.PAYLOAD_STORAGE_S3_BUCKET;
		try {
			const userContent = `inline payload check ${"lorem ipsum ".repeat(200)}`;
			const json = await requestChatCompletion(userContent);

			const logs = await waitForLogs(1);
			const row = logs[0];

			expect(row.payloadRef).toBeNull();
			expect(row.messages).toEqual([{ role: "user", content: userContent }]);
			expect(row.content).toBe(json.choices[0].message.content);
		} finally {
			process.env.PAYLOAD_STORAGE_S3_BUCKET = bucket;
		}
	});
});
