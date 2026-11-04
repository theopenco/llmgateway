import { createServer, request } from "node:http";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { processLogQueue } from "worker";

import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { attachRealtimeServer } from "./realtime/server.js";
import { logRealtimeTurnDenial } from "./realtime/turn-denial-log.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "./test-utils/test-helpers.js";

import type { AddressInfo } from "node:net";

const model = "gpt-realtime-2.1-mini";
const restrictedMessage = "Access is restricted for your organization";

interface UpgradeResult {
	status: number;
	requestId: string | undefined;
	body: string;
}

async function upgrade(
	token = "test-token",
	query = `model=${model}`,
): Promise<UpgradeResult> {
	const server = createServer();
	attachRealtimeServer(server);
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});
	const { port } = server.address() as AddressInfo;
	try {
		return await new Promise<UpgradeResult>((resolve, reject) => {
			const req = request({
				host: "127.0.0.1",
				port,
				path: `/v1/realtime?${query}`,
				headers: {
					Connection: "Upgrade",
					Upgrade: "websocket",
					"Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
					"Sec-WebSocket-Version": "13",
					Authorization: `Bearer ${token}`,
				},
			});
			req.on("response", (res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => {
					body += chunk;
				});
				res.on("end", () => {
					const requestId = res.headers["x-request-id"];
					resolve({
						status: res.statusCode ?? 0,
						requestId: typeof requestId === "string" ? requestId : undefined,
						body,
					});
				});
			});
			req.on("upgrade", () =>
				reject(new Error("Upgrade unexpectedly accepted")),
			);
			req.on("error", reject);
			req.end();
		});
	} finally {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
}

async function readLog() {
	const logs = await waitForLogs();
	expect(logs).toHaveLength(1);
	const log = logs[0];
	expect(log).toMatchObject({
		hasError: true,
		finishReason: "client_error",
		cost: 0,
		usedProvider: "llmgateway",
		apiOrigin: "realtime",
		requestedModel: model,
	});
	return log;
}

async function restrictOpenAI() {
	await db
		.update(tables.organization)
		.set({
			providerAccessRestriction: {
				mode: "deny",
				providers: ["openai"],
				models: [],
				mappings: [],
			},
		})
		.where(eq(tables.organization.id, "org-id"));
}

describe("realtime rejection logs", () => {
	createGatewayApiTestHarness();

	beforeEach(async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("test-token"),
			projectId: "project-id",
			createdBy: "user-id",
			description: "Test API Key",
		});
	});

	afterEach(() => vi.unstubAllEnvs());

	test("logs an upgrade denied by the organization's provider access", async () => {
		await restrictOpenAI();
		const response = await upgrade();
		expect(response.status).toBe(403);
		expect(response.body).toContain(restrictedMessage);
		const log = await readLog();
		expect(log.errorDetails).toMatchObject({ statusCode: 403 });
		expect(log.errorDetails?.responseText).toContain(restrictedMessage);
		expect(response.requestId).toBe(log.requestId);
	});

	test("logs an upgrade from an account under review", async () => {
		await db
			.update(tables.organization)
			.set({ riskFlagged: true })
			.where(eq(tables.organization.id, "org-id"));
		const response = await upgrade();
		expect(response.status).toBe(403);
		expect(await readLog()).toMatchObject({ errorCategory: "account_review" });
	});

	test("logs an upgrade for an unknown model", async () => {
		const response = await upgrade("test-token", "model=nonexistent-model");
		expect(response.status).toBe(400);
		const logs = await waitForLogs();
		expect(logs).toHaveLength(1);
		expect(logs[0]).toMatchObject({
			apiOrigin: "realtime",
			requestedModel: "nonexistent-model",
			errorDetails: { statusCode: 400, cause: "model_not_found" },
		});
	});

	test("does not log an upgrade with an unrecognized key", async () => {
		const response = await upgrade("unknown-key");
		expect(response.status).toBe(401);
		await processLogQueue();
		expect(await db.query.log.findMany()).toHaveLength(0);
	});

	test("logs a client secret mint denied by provider access", async () => {
		vi.stubEnv("REALTIME_ENABLED", "true");
		await restrictOpenAI();
		const response = await app.request("/v1/realtime/client_secrets", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer test-token",
			},
			body: JSON.stringify({ session: { type: "realtime", model } }),
		});
		expect(response.status).toBe(403);
		expect(await response.text()).toContain(restrictedMessage);
		const log = await readLog();
		expect(log.errorDetails?.responseText).toContain(restrictedMessage);
		expect(response.headers.get("x-request-id")).toBe(log.requestId);
	});

	test("logs a turn refused inside an open session", async () => {
		const denial = {
			gatewayToken: "test-token",
			sessionRecordId: "session-id",
			requestedModel: model,
			source: null,
			userAgent: "test-agent",
		};
		await logRealtimeTurnDenial({
			...denial,
			code: "model_access_denied",
			message: `Provider openai is blocked.${restrictedMessage}`,
		});
		await logRealtimeTurnDenial({
			...denial,
			code: "gate_unavailable",
			message: "Unable to verify account state",
		});
		const log = await readLog();
		expect(log).toMatchObject({
			errorCategory: "permission",
			userAgent: "test-agent",
			errorDetails: { statusCode: 403, cause: "model_access_denied" },
		});
		expect(log.requestId.startsWith("session-id:")).toBe(true);
	});
});
