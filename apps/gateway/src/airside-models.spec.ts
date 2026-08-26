import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { db, eq, tables } from "@llmgateway/db";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import {
	clearCache,
	waitForLogByRequestId,
} from "./test-utils/test-helpers.js";

interface CapturedRequest {
	url: string;
	headers: Record<string, string | string[] | undefined>;
	body: Record<string, unknown>;
}

/**
 * Airside carrier listings: an active provider_draft_model with an approved
 * price filing is routable as "<provider>/<modelName>" even though it has no
 * static catalogue entry, and is billed at the filed prices. These tests
 * stand up a mock OpenAI-compatible upstream and point the carrier's
 * provider key at it.
 */
describe("airside-listed models", () => {
	createGatewayApiTestHarness();

	let upstream: Server;
	let upstreamUrl = "";
	let captured: CapturedRequest[] = [];

	beforeAll(async () => {
		upstream = createServer((req, res) => {
			let body = "";
			req.on("data", (chunk) => (body += chunk));
			req.on("end", () => {
				const parsed = JSON.parse(body || "{}") as Record<string, unknown>;
				captured.push({
					url: req.url ?? "",
					headers: req.headers,
					body: parsed,
				});
				res.writeHead(200, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						id: "chatcmpl-luna-1",
						object: "chat.completion",
						model: "gpt-5.6-luna",
						choices: [
							{
								index: 0,
								message: { role: "assistant", content: "Hello from Luna" },
								finish_reason: "stop",
							},
						],
						usage: {
							prompt_tokens: 1000,
							completion_tokens: 500,
							total_tokens: 1500,
						},
					}),
				);
			});
		});
		upstreamUrl = await new Promise<string>((resolve) => {
			upstream.listen(0, () => {
				const address = upstream.address();
				resolve(
					`http://localhost:${typeof address === "object" && address ? address.port : 0}`,
				);
			});
		});
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => {
			upstream.close((err) => (err ? reject(err) : resolve()));
		});
	});

	async function setup(
		token: string,
		options: {
			modelStatus?: "active" | "draft" | "delisted";
			filingStatus?: "approved" | "pending";
		} = {},
	) {
		captured = [];
		await clearCache();
		await db.insert(tables.apiKey).values({
			id: `${token}-id`,
			token,
			projectId: "project-id",
			description: "Airside test key",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: `${token}-mistral-key`,
			token: "mock-mistral-key",
			provider: "mistral",
			organizationId: "org-id",
			baseUrl: upstreamUrl,
		});
		await db.insert(tables.providerCompany).values({
			id: `${token}-company`,
			name: "Mistral AI",
		});
		await db.insert(tables.providerDraftModel).values({
			id: `${token}-model`,
			providerCompanyId: `${token}-company`,
			providerId: "mistral",
			modelName: "gpt-5.6-luna",
			displayName: "GPT 5.6 Luna",
			contextSize: 128000,
			streaming: true,
			tools: true,
			status: options.modelStatus ?? "active",
		});
		await db.insert(tables.providerPriceFiling).values({
			id: `${token}-filing`,
			draftModelId: `${token}-model`,
			providerCompanyId: `${token}-company`,
			kind: "initial",
			inputPrice: "2e-6",
			outputPrice: "1e-5",
			status: options.filingStatus ?? "approved",
		});
	}

	test("routes an approved listing and bills the filed prices", async () => {
		await setup("airside-luna-token");
		const requestId = "airside-luna-req-1";

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer airside-luna-token",
				"x-no-fallback": "true",
				"x-request-id": requestId,
			},
			body: JSON.stringify({
				model: "mistral/gpt-5.6-luna",
				messages: [{ role: "user", content: "Say hi" }],
			}),
		});

		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			choices: { message: { content: string } }[];
			usage: { prompt_tokens: number; completion_tokens: number };
		};
		expect(json.choices[0].message.content).toBe("Hello from Luna");
		expect(json.usage.prompt_tokens).toBe(1000);

		// The upstream got a plain OpenAI-compatible call with the bare model id.
		expect(captured).toHaveLength(1);
		expect(captured[0].url).toBe("/v1/chat/completions");
		expect(captured[0].body.model).toBe("gpt-5.6-luna");
		expect(captured[0].headers.authorization).toBe("Bearer mock-mistral-key");

		// The log attributes the traffic to the carrier and bills the filing.
		const log = await waitForLogByRequestId(requestId);
		expect(log).toBeTruthy();
		expect(log!.usedProvider).toBe("mistral");
		expect(log!.usedModel).toBe("mistral/gpt-5.6-luna");
		// 1000 tokens at $2/M in + 500 tokens at $10/M out.
		expect(Number(log!.inputCost)).toBeCloseTo(0.002, 6);
		expect(Number(log!.outputCost)).toBeCloseTo(0.005, 6);
		expect(Number(log!.cost)).toBeCloseTo(0.007, 6);
	});

	test("lists the approved listing in /v1/models", async () => {
		await setup("airside-v1models-token");
		const res = await app.request("/v1/models");
		expect(res.status).toBe(200);
		const { data } = (await res.json()) as { data: { id: string }[] };
		expect(data.some((m) => m.id === "gpt-5.6-luna")).toBe(true);

		const mappedRes = await app.request("/v1/models?mapped=true");
		const mapped = (await mappedRes.json()) as { data: { id: string }[] };
		expect(mapped.data.some((m) => m.id === "mistral/gpt-5.6-luna")).toBe(true);
	});

	test("does not route a listing that is still drafted", async () => {
		await setup("airside-draft-token", {
			modelStatus: "draft",
			filingStatus: "pending",
		});
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer airside-draft-token",
			},
			body: JSON.stringify({
				model: "mistral/gpt-5.6-luna",
				messages: [{ role: "user", content: "Say hi" }],
			}),
		});
		expect(res.status).toBe(400);
		expect(captured).toHaveLength(0);
	});

	test("does not route a delisted model", async () => {
		await setup("airside-delisted-token", { modelStatus: "delisted" });
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer airside-delisted-token",
			},
			body: JSON.stringify({
				model: "mistral/gpt-5.6-luna",
				messages: [{ role: "user", content: "Say hi" }],
			}),
		});
		expect(res.status).toBe(400);
		expect(captured).toHaveLength(0);
	});

	async function setupCustomCarrier(
		token: string,
		options: { managedCredential?: boolean } = {},
	) {
		captured = [];
		await clearCache();
		await db.insert(tables.apiKey).values({
			id: `${token}-id`,
			token,
			projectId: "project-id",
			description: "Airside custom carrier test key",
			createdBy: "user-id",
		});
		// Credits mode: custom carriers are served by the platform's managed
		// credential, never by org BYOK keys.
		await db
			.update(tables.project)
			.set({ mode: "credits" })
			.where(eq(tables.project.id, "project-id"));
		await db.insert(tables.providerCompany).values({
			id: `${token}-company`,
			name: "Acme Sky",
		});
		await db.insert(tables.providerClaim).values({
			id: `${token}-claim`,
			providerCompanyId: `${token}-company`,
			providerId: "acme-sky",
			kind: "custom",
			matchedDomain: "acme-sky.ai",
			customName: "Acme Sky",
			customBaseUrl: upstreamUrl,
			status: "active",
		});
		await db.insert(tables.providerDraftModel).values({
			id: `${token}-model`,
			providerCompanyId: `${token}-company`,
			providerId: "acme-sky",
			modelName: "sky-large",
			displayName: "Sky Large",
			contextSize: 64000,
			streaming: true,
			status: "active",
		});
		await db.insert(tables.providerPriceFiling).values({
			id: `${token}-filing`,
			draftModelId: `${token}-model`,
			providerCompanyId: `${token}-company`,
			kind: "initial",
			inputPrice: "3e-6",
			outputPrice: "9e-6",
			status: "approved",
		});
		if (options.managedCredential !== false) {
			await db.insert(tables.providerKey).values({
				id: `${token}-managed-key`,
				managed: true,
				organizationId: null,
				provider: "acme-sky",
				token: "mock-acme-key",
			});
		}
	}

	test("routes a custom carrier to its registered endpoint on the managed credential", async () => {
		await setupCustomCarrier("airside-custom-token");
		const requestId = "airside-custom-req-1";

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer airside-custom-token",
				"x-no-fallback": "true",
				"x-request-id": requestId,
			},
			body: JSON.stringify({
				model: "acme-sky/sky-large",
				messages: [{ role: "user", content: "Say hi" }],
			}),
		});

		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			choices: { message: { content: string } }[];
		};
		expect(json.choices[0].message.content).toBe("Hello from Luna");

		// The claim's base URL got a plain OpenAI-compatible call, authorized
		// with the platform's managed credential for the carrier.
		expect(captured).toHaveLength(1);
		expect(captured[0].url).toBe("/v1/chat/completions");
		expect(captured[0].body.model).toBe("sky-large");
		expect(captured[0].headers.authorization).toBe("Bearer mock-acme-key");

		const log = await waitForLogByRequestId(requestId);
		expect(log).toBeTruthy();
		expect(log!.usedProvider).toBe("acme-sky");
		expect(log!.usedModel).toBe("acme-sky/sky-large");
		// 1000 tokens at $3/M in + 500 tokens at $9/M out.
		expect(Number(log!.inputCost)).toBeCloseTo(0.003, 6);
		expect(Number(log!.outputCost)).toBeCloseTo(0.0045, 6);
	});

	test("custom carrier without a managed credential fails with a clear error", async () => {
		await setupCustomCarrier("airside-nocred-token", {
			managedCredential: false,
		});
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer airside-nocred-token",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "acme-sky/sky-large",
				messages: [{ role: "user", content: "Say hi" }],
			}),
		});
		expect(res.status).toBe(400);
		const json = (await res.json()) as { error: { message: string } };
		expect(json.error.message).toContain("No platform credential");
		expect(captured).toHaveLength(0);
	});

	test("does not route an unregistered provider prefix", async () => {
		await setupCustomCarrier("airside-unknown-token");
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer airside-unknown-token",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "nobody-here/sky-large",
				messages: [{ role: "user", content: "Say hi" }],
			}),
		});
		expect(res.status).toBe(400);
		expect(captured).toHaveLength(0);
	});
});
