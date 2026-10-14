import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/app.js";
import {
	lookupReasoningPin,
	reasoningPinBindsModel,
	rememberReasoningCredential,
} from "@/chat/tools/reasoning-credential-pin.js";
import { setPreferredProvider } from "@/lib/preferred-provider.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "@/test-utils/test-helpers.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { cdb, db, eq, tables } from "@llmgateway/db";
import { models } from "@llmgateway/models";
import {
	getApiKeyFingerprint,
	hashApiKeyForStorage,
} from "@llmgateway/shared/api-key-hash";

const MODEL = "openai/gpt-6.1-sol";

/**
 * OpenAI and Azure only verify replayed encrypted reasoning on the account
 * that produced it, so the turn replaying it must use that credential.
 */
describe("reasoning credential pinning", () => {
	const harness = createGatewayApiTestHarness();
	let previousEnvKey: string | undefined;

	beforeEach(async () => {
		previousEnvKey = process.env.LLM_OPENAI_API_KEY;
		delete process.env.LLM_OPENAI_API_KEY;
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		if (previousEnvKey === undefined) {
			delete process.env.LLM_OPENAI_API_KEY;
		} else {
			process.env.LLM_OPENAI_API_KEY = previousEnvKey;
		}
	});

	async function seedKey(values: {
		id: string;
		token: string;
		managed: boolean;
		sortOrder?: number;
		provider?: string;
		config?: Record<string, string>;
	}) {
		await cdb.insert(tables.providerKey).values({
			id: values.id,
			provider: values.provider ?? "openai",
			config: values.config,
			...encryptProviderKeyForStorage(
				values.token,
				values.id,
				values.managed ? null : "org-id",
			),
			managed: values.managed,
			organizationId: values.managed ? null : "org-id",
			sortOrder: values.sortOrder,
		});
	}

	async function markPendingDeletion(id: string) {
		await cdb
			.update(tables.providerKey)
			.set({ status: "pending_deletion", deletionRequestedAt: new Date() })
			.where(eq(tables.providerKey.id, id));
	}

	/** Upstream that answers every request with reasoning tied to its token. */
	/** Each upstream call's credential and whether it replayed reasoning. */
	const replayedReasoning: boolean[] = [];

	function mockUpstream(
		status: number | ((authorization: string, body: string) => number) = 200,
	): string[] {
		const authorizations: string[] = [];
		replayedReasoning.length = 0;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
			const headers = new Headers(init?.headers);
			const authorization =
				headers.get("authorization") ??
				(headers.has("api-key") ? `api-key ${headers.get("api-key")}` : "");
			authorizations.push(authorization);
			const body = typeof init?.body === "string" ? init.body : "";
			replayedReasoning.push(body.includes('"encrypted_content"'));
			const code =
				typeof status === "function" ? status(authorization, body) : status;
			if (code === 400) {
				return new Response(
					JSON.stringify({
						error: {
							message:
								"The encrypted content for item rs_1 could not be verified.",
							type: "invalid_request_error",
							code: "invalid_encrypted_content",
						},
					}),
					{ status: 400, headers: { "Content-Type": "application/json" } },
				);
			}
			if (code !== 200) {
				return new Response(
					JSON.stringify({ error: { message: "upstream failure" } }),
					{ status: code, headers: { "Content-Type": "application/json" } },
				);
			}
			return new Response(
				JSON.stringify({
					id: "resp_pin",
					object: "response",
					status: "completed",
					model: "gpt-6.1-sol",
					output: [
						{
							type: "reasoning",
							id: `rs_${authorizations.length}`,
							summary: [],
							encrypted_content: `enc:${authorization}`,
						},
						{
							type: "message",
							id: `msg_${authorizations.length}`,
							role: "assistant",
							content: [{ type: "output_text", text: "Done" }],
						},
					],
					usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10 },
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});
		return authorizations;
	}

	async function turn(reasoningData?: string, model = MODEL) {
		const messages: unknown[] = [{ role: "user", content: "Start" }];
		if (reasoningData) {
			messages.push(
				{
					role: "assistant",
					content: "Done",
					reasoning_details: [
						{
							type: "reasoning.encrypted",
							data: reasoningData,
							format: "openai-responses-v1",
							index: 0,
						},
					],
				},
				{ role: "user", content: "Continue" },
			);
		}
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: "Bearer real-token",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ model, messages }),
		});
		return res;
	}

	async function firstTurnReasoning(): Promise<string> {
		const res = await turn();
		expect(res.status).toBe(200);
		const json = await res.json();
		const data = json.choices[0].message.reasoning_details?.[0]?.data;
		expect(typeof data).toBe("string");
		return data as string;
	}

	test("routes a replay to the provider that produced its reasoning", async () => {
		await harness.setProjectMode("credits");
		await seedKey({ id: "managed-openai", token: "sk-openai", managed: true });
		await seedKey({
			id: "managed-azure",
			token: "azure-token",
			managed: true,
			provider: "azure",
			config: { resource: "pin-test" },
		});
		const authorizations = mockUpstream();

		const reasoning = await firstTurnReasoning();
		expect(authorizations).toEqual(["Bearer sk-openai"]);

		// Without a session id, the org-wide preferred provider would win.
		await setPreferredProvider("org-id", "gpt-6.1-sol", "azure");
		expect((await turn(reasoning, "gpt-6.1-sol")).status).toBe(200);
		expect((await turn(undefined, "gpt-6.1-sol")).status).toBe(200);
		expect(authorizations).toEqual([
			"Bearer sk-openai",
			"Bearer sk-openai",
			"api-key azure-token",
		]);
	});

	test("keeps a managed credential after the primary changes and it is deleted", async () => {
		await harness.setProjectMode("credits");
		await seedKey({ id: "managed-a", token: "sk-managed-a", managed: true });
		const authorizations = mockUpstream();

		const reasoning = await firstTurnReasoning();
		expect(authorizations).toEqual(["Bearer sk-managed-a"]);

		await seedKey({
			id: "managed-b",
			token: "sk-managed-b",
			managed: true,
			sortOrder: 0,
		});
		await markPendingDeletion("managed-a");

		expect((await turn(reasoning)).status).toBe(200);
		// Fresh conversations never touch a key pending deletion.
		expect((await turn()).status).toBe(200);
		expect(authorizations).toEqual([
			"Bearer sk-managed-a",
			"Bearer sk-managed-a",
			"Bearer sk-managed-b",
		]);
	});

	test("keeps an organization key through its grace period only", async () => {
		await harness.setProjectMode("api-keys");
		await seedKey({ id: "byok-a", token: "sk-byok-a", managed: false });
		const authorizations = mockUpstream();

		const reasoning = await firstTurnReasoning();
		await seedKey({ id: "byok-b", token: "sk-byok-b", managed: false });
		await markPendingDeletion("byok-a");
		expect((await turn(reasoning)).status).toBe(200);

		await cdb
			.update(tables.providerKey)
			.set({ status: "deleted" })
			.where(eq(tables.providerKey.id, "byok-a"));
		expect((await turn(reasoning)).status).toBe(200);

		expect(authorizations).toEqual([
			"Bearer sk-byok-a",
			"Bearer sk-byok-a",
			"Bearer sk-byok-b",
		]);
	});

	test("serves a replay when the deleted key was the only one", async () => {
		await harness.setProjectMode("api-keys");
		await seedKey({ id: "byok-only", token: "sk-byok-only", managed: false });
		const authorizations = mockUpstream();

		const reasoning = await firstTurnReasoning();
		await markPendingDeletion("byok-only");

		expect((await turn(reasoning, "gpt-6.1-sol")).status).toBe(200);
		// Nothing else may use it: a fresh conversation has no key left.
		expect((await turn(undefined, "gpt-6.1-sol")).status).toBe(400);
		expect(authorizations).toEqual([
			"Bearer sk-byok-only",
			"Bearer sk-byok-only",
		]);
	});

	test("resolves an env credential by fingerprint, not position", async () => {
		await harness.setProjectMode("credits");
		process.env.LLM_OPENAI_API_KEY = "sk-env-a,sk-env-b";
		await rememberReasoningCredential(
			"org-id",
			{
				reasoning_details: [
					{
						type: "reasoning.encrypted",
						data: "enc-from-env-b",
						format: "openai-responses-v1",
						index: 0,
					},
				],
			},
			{
				provider: "openai",
				source: "env",
				envVarName: "LLM_OPENAI_API_KEY",
				apiKeyHash: getApiKeyFingerprint("sk-env-b"),
			},
		);
		const authorizations = mockUpstream();

		expect((await turn("enc-from-env-b")).status).toBe(200);
		expect(authorizations).toEqual(["Bearer sk-env-b"]);
	});

	test("pins Gemini tool-call signatures restored from the cache", async () => {
		await harness.setProjectMode("api-keys");
		await seedKey({
			id: "google-a",
			token: "google-key-a",
			managed: false,
			provider: "google-ai-studio",
		});
		const credentials: string[] = [];
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url = new URL(
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: input.url,
			);
			credentials.push(
				new Headers(init?.headers).get("x-goog-api-key") ??
					url.searchParams.get("key") ??
					"",
			);
			return new Response(
				JSON.stringify({
					candidates: [
						{
							content: {
								role: "model",
								parts: [
									{
										functionCall: { name: "lookup", args: {} },
										thoughtSignature: `sig-${credentials.length}`,
									},
								],
							},
							finishReason: "STOP",
						},
					],
					usageMetadata: {
						promptTokenCount: 5,
						candidatesTokenCount: 5,
						totalTokenCount: 10,
					},
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});
		const tools = [
			{
				type: "function",
				function: {
					name: "lookup",
					parameters: { type: "object", properties: {} },
				},
			},
		];
		const request = async (messages: unknown[]) =>
			await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					Authorization: "Bearer real-token",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "google-ai-studio/gemini-3.5-flash",
					messages,
					tools,
				}),
			});
		const initial = { role: "user", content: "Look it up." };

		const first = await request([initial]);
		expect(first.status).toBe(200);
		const call = (await first.json()).choices[0].message.tool_calls[0];
		expect(typeof call.id).toBe("string");

		await seedKey({
			id: "google-b",
			token: "google-key-b",
			managed: false,
			provider: "google-ai-studio",
			sortOrder: 0,
		});
		await markPendingDeletion("google-a");

		// The client drops the signature; the gateway restores it by call id.
		const { extra_content: _dropped, ...unsigned } = call;
		expect(
			(
				await request([
					initial,
					{ role: "assistant", content: null, tool_calls: [unsigned] },
					{ role: "tool", tool_call_id: call.id, content: "42" },
				])
			).status,
		).toBe(200);
		expect((await request([initial])).status).toBe(200);
		expect(credentials).toEqual([
			"google-key-a",
			"google-key-a",
			"google-key-b",
		]);
	});

	test("fails a pinned turn over to another key without its reasoning", async () => {
		await harness.setProjectMode("credits");
		await seedKey({ id: "managed-a", token: "sk-managed-a", managed: true });
		const healthy = mockUpstream();
		const reasoning = await firstTurnReasoning();
		expect(healthy).toEqual(["Bearer sk-managed-a"]);

		await seedKey({ id: "managed-b", token: "sk-managed-b", managed: true });
		vi.restoreAllMocks();
		const attempts = mockUpstream((authorization) =>
			authorization === "Bearer sk-managed-a" ? 429 : 200,
		);

		const res = await turn(reasoning);
		expect(res.status).toBe(200);
		expect(attempts).toEqual(["Bearer sk-managed-a", "Bearer sk-managed-b"]);
		// The pinned key gets the reasoning; the other key cannot verify it.
		expect(replayedReasoning).toEqual([true, false]);
		const logs = await waitForLogs(2);
		expect(
			logs.find((log) => !log.hasError)?.routingMetadata
				?.encryptedReasoningDropped,
		).toBe(true);
	});

	test("retries once without reasoning an account rejects", async () => {
		await harness.setProjectMode("credits");
		await seedKey({ id: "managed-a", token: "sk-managed-a", managed: true });
		// No pin: the reasoning came from somewhere this gateway never saw.
		const attempts = mockUpstream((_authorization, body) =>
			body.includes('"encrypted_content"') ? 400 : 200,
		);

		const res = await turn("enc:from-another-account");
		expect(res.status).toBe(200);
		expect(attempts).toEqual(["Bearer sk-managed-a", "Bearer sk-managed-a"]);
		expect(replayedReasoning).toEqual([true, false]);
	});

	test("does not retry a rejected replay more than once", async () => {
		await harness.setProjectMode("credits");
		await seedKey({ id: "managed-a", token: "sk-managed-a", managed: true });
		const attempts = mockUpstream(400);

		expect((await turn("enc:from-another-account")).status).toBe(400);
		expect(attempts).toHaveLength(2);
	});
});

describe("reasoning pin lookup order", () => {
	test("checks payload ids before tool-call ids", async () => {
		const credential = (provider: string) => ({
			provider,
			source: "managed" as const,
			providerKeyId: `key-${provider}`,
			apiKeyHash: "hash",
		});
		// A stale pin under the tool-call id must not outrank the payload's.
		await rememberReasoningCredential(
			"order-org",
			{
				tool_calls: [
					{
						id: "call_order",
						extra_content: { google: { thought_signature: "old-sig" } },
					},
				],
			},
			credential("azure"),
		);
		await rememberReasoningCredential(
			"order-org",
			{
				reasoning_details: [
					{
						type: "reasoning.encrypted",
						data: "payload-order",
						format: "openai-responses-v1",
					},
				],
			},
			credential("openai"),
		);
		const pin = await lookupReasoningPin("order-org", [
			{
				role: "assistant",
				reasoning_details: [
					{
						type: "reasoning.encrypted",
						data: "payload-order",
						format: "openai-responses-v1",
					},
				],
				tool_calls: [{ id: "call_order" }],
			},
		]);
		expect(pin?.provider).toBe("openai");
	});

	test("searches past a newest turn with only unsigned tool calls", async () => {
		await rememberReasoningCredential(
			"older-org",
			{
				reasoning_details: [
					{
						type: "reasoning.encrypted",
						data: "older-payload",
						format: "openai-responses-v1",
					},
				],
			},
			{
				provider: "azure",
				source: "managed",
				providerKeyId: "key-azure",
				apiKeyHash: "hash",
			},
		);
		const pin = await lookupReasoningPin("older-org", [
			{ role: "user", content: "Start" },
			{
				role: "assistant",
				reasoning_details: [
					{
						type: "reasoning.encrypted",
						data: "older-payload",
						format: "openai-responses-v1",
					},
				],
			},
			{ role: "user", content: "Use the tool" },
			{
				role: "assistant",
				tool_calls: [{ id: "call_unsigned" }],
			},
			{ role: "tool", content: "42" },
		]);
		expect(pin?.providerKeyId).toBe("key-azure");
	});
});

describe("reasoningPinBindsModel", () => {
	const mappings = (id: string) =>
		models.find((model) => model.id === id)?.providers;
	const pin = (provider: string) => ({
		provider,
		source: "managed" as const,
		providerKeyId: "key",
		apiKeyHash: "hash",
	});

	test.each(["openai", "azure"])(
		"binds reasoning text models on %s",
		(provider) => {
			expect(
				reasoningPinBindsModel(pin(provider), mappings("gpt-6.1-sol")),
			).toBe(true);
		},
	);

	test.each(["openai", "azure"])(
		"leaves image models on %s unpinned",
		(provider) => {
			expect(
				reasoningPinBindsModel(pin(provider), mappings("gpt-image-2")),
			).toBe(false);
		},
	);

	test("ignores a pin for a provider the model has no mapping on", () => {
		expect(
			reasoningPinBindsModel(pin("google-ai-studio"), mappings("gpt-6.1-sol")),
		).toBe(false);
		expect(reasoningPinBindsModel(undefined, mappings("gpt-6.1-sol"))).toBe(
			false,
		);
	});
});
