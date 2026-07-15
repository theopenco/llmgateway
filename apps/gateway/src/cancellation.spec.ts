import { serve } from "@hono/node-server";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";

import { db, tables } from "@llmgateway/db";

import { app } from "./app.js";
import {
	resetMockCheckpoints,
	startMockServer,
	stopMockServer,
	waitForMockCheckpoint,
} from "./test-utils/mock-openai-server.js";
import { clearCache, waitForLogs } from "./test-utils/test-helpers.js";

import type { ServerType } from "@hono/node-server";

// These tests exercise *real* client cancellation: the gateway is served over
// an actual HTTP socket so that aborting the client request closes the socket
// and fires the handler's `c.req.raw.signal`. The in-process `app.request()`
// harness used elsewhere does not surface the client abort to the handler, so
// cancellation cannot be tested there.
describe("client cancellation logging", () => {
	let mockServerUrl: string;
	let gatewayServer: ServerType;
	let gatewayUrl: string;

	async function setupFixtures() {
		await db
			.insert(tables.user)
			.values({ id: "user-id", name: "user", email: "user" })
			.onConflictDoNothing();
		await db
			.insert(tables.organization)
			.values({
				id: "org-id",
				name: "Test Organization",
				billingEmail: "user",
				plan: "pro",
				retentionLevel: "retain",
				credits: "100.00",
			})
			.onConflictDoNothing();
		await db
			.insert(tables.userOrganization)
			.values({
				id: "user-org-id",
				userId: "user-id",
				organizationId: "org-id",
			})
			.onConflictDoNothing();
		await db
			.insert(tables.project)
			.values({
				id: "project-id",
				name: "Test Project",
				organizationId: "org-id",
				mode: "api-keys",
			})
			.onConflictDoNothing();
		await db
			.insert(tables.apiKey)
			.values({
				id: "token-id",
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			})
			.onConflictDoNothing();
		// llmgateway provider has cancellation: true, so requestCanBeCanceled is
		// true and the abort propagates to the upstream request.
		await db
			.insert(tables.providerKey)
			.values({
				id: "provider-key-id",
				token: "sk-test-key",
				provider: "llmgateway",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			})
			.onConflictDoNothing();
	}

	async function resetState() {
		await clearCache();
		await db.delete(tables.log);
		await db.delete(tables.providerKey);
		await db.delete(tables.apiKey);
		await db.delete(tables.project);
		await db.delete(tables.userOrganization);
		await db.delete(tables.organization);
		await db.delete(tables.user);
	}

	beforeAll(async () => {
		mockServerUrl = await startMockServer();
		gatewayUrl = await new Promise<string>((resolve) => {
			gatewayServer = serve({ fetch: app.fetch, port: 0 }, (info) =>
				resolve(`http://localhost:${info.port}`),
			);
		});
	});

	afterAll(async () => {
		stopMockServer();
		await new Promise<void>((resolve) => gatewayServer.close(() => resolve()));
	});

	beforeEach(async () => {
		resetMockCheckpoints();
		await resetState();
		await setupFixtures();
	});

	// Give the gateway a beat to move past the checkpoint (e.g. from the fetch
	// settling into res.text()/res.json()) before aborting. Any earlier or later
	// abort ordering still logs `canceled: true`, so this only biases toward the
	// specific path each test targets — it is not load-bearing for correctness.
	function settle() {
		return new Promise((resolve) => setTimeout(resolve, 50));
	}

	function postChat(content: string, signal: AbortSignal) {
		return fetch(`${gatewayUrl}/v1/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "llmgateway/custom",
				messages: [{ role: "user", content }],
			}),
			signal,
		});
	}

	test("abort before the upstream responds is logged as canceled, not an error", async () => {
		const controller = new AbortController();
		// Mock delays 5s before sending any response; abort lands while the
		// gateway is awaiting the upstream fetch. The checkpoint resolves once
		// the mock has received the gateway's upstream request and started its
		// delay, so the abort verifiably lands mid-fetch instead of racing a
		// fixed sleep against slow CI runners.
		const upstreamRequestReceived = waitForMockCheckpoint("TRIGGER_TIMEOUT");
		const requestPromise = postChat(
			`TRIGGER_TIMEOUT_5000 ${Math.random()}`,
			controller.signal,
		);
		await upstreamRequestReceived;
		controller.abort();

		await expect(requestPromise).rejects.toThrow();

		const logs = await waitForLogs(1);
		expect(logs.length).toBe(1);
		const log = logs[0];
		expect(log.canceled).toBe(true);
		expect(log.finishReason).toBe("canceled");
		expect(log.hasError).toBe(false);
		expect(log.errorDetails).toBeNull();
	});

	test("abort while reading the response body is logged as canceled, not an error", async () => {
		const controller = new AbortController();
		// Mock returns 200 headers + a partial body, then hangs without
		// finishing it. The abort lands while the gateway is awaiting
		// res.json(), exercising the body-read cancellation path. The
		// checkpoint resolves once the mock has flushed the partial body, so
		// the gateway verifiably has the upstream request in flight before the
		// abort fires.
		const partialBodyFlushed = waitForMockCheckpoint("TRIGGER_BODY_HANG");
		const requestPromise = postChat(
			`TRIGGER_BODY_HANG ${Math.random()}`,
			controller.signal,
		);
		await partialBodyFlushed;
		await settle();
		controller.abort();

		await expect(requestPromise).rejects.toThrow();

		const logs = await waitForLogs(1);
		expect(logs.length).toBe(1);
		const log = logs[0];
		expect(log.canceled).toBe(true);
		expect(log.finishReason).toBe("canceled");
		expect(log.hasError).toBe(false);
		expect(log.errorDetails).toBeNull();
	});

	test("abort while reading a non-OK error body is logged as canceled, not an error", async () => {
		const controller = new AbortController();
		// Mock returns a 500 status + a partial error body, then hangs without
		// finishing it. The abort lands while the gateway is awaiting res.text()
		// on the error path, exercising the error-body cancellation path. The
		// checkpoint resolves once the mock has flushed the partial error body,
		// so the gateway verifiably has the upstream request in flight before
		// the abort fires.
		const partialBodyFlushed = waitForMockCheckpoint("TRIGGER_5XX_BODY_HANG");
		const requestPromise = postChat(
			`TRIGGER_5XX_BODY_HANG ${Math.random()}`,
			controller.signal,
		);
		await partialBodyFlushed;
		await settle();
		controller.abort();

		await expect(requestPromise).rejects.toThrow();

		const logs = await waitForLogs(1);
		expect(logs.length).toBe(1);
		const log = logs[0];
		expect(log.canceled).toBe(true);
		expect(log.finishReason).toBe("canceled");
		expect(log.hasError).toBe(false);
		expect(log.errorDetails).toBeNull();
	});
});
