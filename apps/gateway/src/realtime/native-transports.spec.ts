import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";

import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import * as clientSecrets from "./client-secrets.js";
import * as upstream from "./connect-upstream.js";

const sdp = "v=0\r\ns=transport-fixture\r\nt=0 0\r\n";
const session = { type: "realtime", model: "openai/gpt-realtime" };

const requests = [
	{
		name: "raw SDP negotiation",
		path: "/v1/realtime/calls",
		contentType: "application/sdp",
		body: () => sdp,
		status: 415,
	},
	{
		name: "multipart SDP negotiation",
		path: "/v1/realtime/calls",
		contentType: undefined,
		body: () => {
			const form = new FormData();
			form.set("sdp", sdp);
			form.set("session", JSON.stringify(session));
			return form;
		},
		status: 415,
	},
	{
		name: "JSON SDP negotiation",
		path: "/v1/realtime/calls",
		contentType: "application/json",
		body: () => JSON.stringify({ sdp, session }),
		status: 404,
	},
	...["accept", "reject", "refer", "hangup"].map((action) => ({
		name: `SIP ${action}`,
		path: `/v1/realtime/calls/rtc_test/${action}`,
		contentType: "application/json",
		body: () =>
			JSON.stringify(
				action === "accept"
					? session
					: action === "refer"
						? { target_uri: "sip:agent@example.com" }
						: {},
			),
		status: 404,
	})),
];

describe("unsupported native realtime transports", () => {
	createGatewayApiTestHarness();

	beforeEach(async () => {
		vi.stubEnv("REALTIME_ENABLED", "true");
		await db.insert(tables.apiKey).values({
			id: "native-transport-key",
			...hashApiKeyForStorage("test-token"),
			projectId: "project-id",
			createdBy: "user-id",
			description: "Native transport test key",
		});
		vi.spyOn(globalThis, "fetch").mockRejectedValue(
			new Error("Unexpected native transport HTTP egress"),
		);
		vi.spyOn(upstream, "connectUpstream").mockRejectedValue(
			new Error("Unexpected native transport WebSocket egress"),
		);
		vi.spyOn(clientSecrets, "createClientSecret").mockRejectedValue(
			new Error("Unexpected native transport secret issuance"),
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	describe.each([
		{ name: "authenticated", token: "test-token" },
		{ name: "unauthenticated", token: null },
	])("$name caller", ({ token }) => {
		test.each(requests)(
			"rejects $name without provider egress",
			async (request) => {
				const headers = new Headers();
				if (token) {
					headers.set("Authorization", `Bearer ${token}`);
				}
				if (request.contentType) {
					headers.set("Content-Type", request.contentType);
				}
				const response = await app.request(request.path, {
					method: "POST",
					headers,
					body: request.body(),
				});

				expect(response.status).toBe(request.status);
				expect(response.headers.get("location")).toBeNull();
				expect(response.headers.get("content-type")).not.toContain(
					"application/sdp",
				);
				const body = await response.text();
				expect(body.includes(sdp)).toBe(false);
				expect(body.includes(JSON.stringify(sdp).slice(1, -1))).toBe(false);
				expect(body.includes(clientSecrets.CLIENT_SECRET_PREFIX)).toBe(false);
				expect(globalThis.fetch).not.toHaveBeenCalled();
				expect(upstream.connectUpstream).not.toHaveBeenCalled();
				expect(clientSecrets.createClientSecret).not.toHaveBeenCalled();
			},
		);
	});
});
