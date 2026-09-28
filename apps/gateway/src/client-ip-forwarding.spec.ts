import { afterEach, describe, expect, test, vi } from "vitest";

import { db, tables } from "@llmgateway/db";
import { clientIpMissingTotal } from "@llmgateway/instrumentation";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

const endpoints = [
	{
		path: "/v1/messages",
		body: {
			model: "gpt-4o-mini",
			max_tokens: 16,
			messages: [{ role: "user", content: "Hello" }],
		},
	},
	{
		path: "/v1/responses",
		body: { model: "gpt-4o-mini", input: "Hello", store: false },
	},
	{
		path: "/v1/responses/compact",
		body: { model: "gpt-4o-mini", input: "Hello" },
	},
	{
		path: "/v1/images/generations",
		body: { model: "gemini-2.5-flash-image", prompt: "A tree" },
	},
	{
		path: "/v4/ai/language-model",
		body: {
			prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
		},
	},
];

describe("client IP across internal gateway requests", () => {
	createGatewayApiTestHarness();
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	async function missingIpCount() {
		const metric = await clientIpMissingTotal.get();
		return metric.values.reduce((total, entry) => total + entry.value, 0);
	}

	describe.each([
		{ header: undefined, value: "192.0.2.1, 192.0.2.2" },
		{ header: "X-Client-Ip", value: "192.0.2.1" },
		{ header: "X-Client-Ip", value: undefined },
	])("configured header $header, value $value", ({ header, value }) => {
		test.each(endpoints)(
			"$path preserves IP rules and metrics",
			async ({ path, body }) => {
				vi.stubEnv("CLIENT_IP_HEADER", header);
				await db.insert(tables.apiKey).values({
					id: "ip-forwarding-key",
					description: "IP forwarding test key",
					...hashApiKeyForStorage("ip-forwarding-token"),
					projectId: "project-id",
					createdBy: "user-id",
				});
				// Both rules prevent an upstream call: a lost IP fails the allowlist,
				// while the preserved IP reaches the deny rule.
				await db.insert(tables.apiKeyIamRule).values([
					{
						id: "ip-forwarding-allow",
						apiKeyId: "ip-forwarding-key",
						ruleType: "allow_ip_cidrs",
						ruleValue: { ipCidrs: ["192.0.2.0/24"] },
						status: "active",
					},
					{
						id: "ip-forwarding-deny",
						apiKeyId: "ip-forwarding-key",
						ruleType: "deny_ip_cidrs",
						ruleValue: { ipCidrs: ["192.0.2.0/24"] },
						status: "active",
					},
				]);
				const headers = new Headers({
					"content-type": "application/json",
					authorization: "Bearer ip-forwarding-token",
					"ai-gateway-protocol-version": "0.0.1",
					"ai-language-model-specification-version": "4",
					"ai-language-model-id": "openai/gpt-4o-mini",
					"ai-language-model-streaming": "false",
					// Never use a different header when the configured one is absent.
					"x-forwarded-for": "198.51.100.1",
					"x-real-ip": "198.51.100.2",
				});
				if (value) {
					headers.set(header ?? "x-forwarded-for", value);
				}
				const before = await missingIpCount();
				const response = await app.request(path, {
					method: "POST",
					headers,
					body: JSON.stringify(body),
				});

				expect(response.status).toBe(403);
				expect(await response.text()).toContain(
					value
						? "Client IP 192.0.2.1 is in the denied CIDR ranges"
						: "Client IP could not be determined",
				);
				expect((await missingIpCount()) - before).toBe(value ? 0 : 2);
			},
		);
	});
});
