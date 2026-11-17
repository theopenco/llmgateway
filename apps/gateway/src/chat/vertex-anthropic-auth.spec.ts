import { generateKeyPairSync } from "node:crypto";

import { afterEach, describe, expect, test, vi } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";

import {
	encryptProviderKeyForStorage,
	GOOGLE_OAUTH_TOKEN_URI,
} from "@llmgateway/actions";
import { cdb, db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

const SA_ENV = "LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON";
const PROJECT_ENV = "LLM_VERTEX_ANTHROPIC_PROJECT";

/**
 * Every vertex-anthropic credential is service-account JSON that has to be
 * exchanged for an OAuth access token, on the first attempt and on every
 * retry or fallback.
 */
describe("vertex-anthropic auth", () => {
	const harness = createGatewayApiTestHarness();

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	function serviceAccount(name: string, projectId: string): string {
		const { privateKey } = generateKeyPairSync("rsa", {
			modulusLength: 2048,
			privateKeyEncoding: { type: "pkcs8", format: "pem" },
			publicKeyEncoding: { type: "spki", format: "pem" },
		});
		return JSON.stringify({
			type: "service_account",
			project_id: projectId,
			client_email: `${name}@${projectId}.iam.gserviceaccount.test`,
			private_key: privateKey,
		});
	}

	function accessTokenFor(name: string): string {
		return `access-token-${name}`;
	}

	interface VertexCall {
		url: string;
		authorization: string | null;
	}

	/**
	 * Mints `access-token-<name>` for the service account named in the signed
	 * assertion, fails the first Vertex call with a connect error and answers
	 * the rest.
	 */
	function mockUpstream(): VertexCall[] {
		const calls: VertexCall[] = [];
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: input.url;
			if (url === GOOGLE_OAUTH_TOKEN_URI) {
				const assertion = new URLSearchParams(String(init?.body)).get(
					"assertion",
				);
				const claim = JSON.parse(
					Buffer.from(assertion!.split(".")[1], "base64url").toString(),
				) as { iss: string };
				return Response.json({
					access_token: accessTokenFor(claim.iss.split("@")[0]),
					expires_in: 3600,
				});
			}
			calls.push({
				url,
				authorization: new Headers(init?.headers).get("authorization"),
			});
			if (calls.length === 1) {
				throw new TypeError("fetch failed", {
					cause: Object.assign(new Error("Connect Timeout Error"), {
						code: "UND_ERR_CONNECT_TIMEOUT",
					}),
				});
			}
			return Response.json({
				id: "msg_vertex",
				type: "message",
				role: "assistant",
				model: "claude-haiku-4-5",
				content: [{ type: "text", text: "Hello" }],
				stop_reason: "end_turn",
				usage: { input_tokens: 1, output_tokens: 1 },
			});
		});
		return calls;
	}

	async function seedApiKey(mode: "credits" | "api-keys") {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		await harness.setProjectMode(mode);
	}

	async function seedProviderKey(values: {
		id: string;
		token: string;
		managed: boolean;
		config?: Record<string, string>;
	}) {
		await cdb.insert(tables.providerKey).values({
			id: values.id,
			provider: "vertex-anthropic",
			...encryptProviderKeyForStorage(
				values.token,
				values.id,
				values.managed ? null : "org-id",
			),
			managed: values.managed,
			organizationId: values.managed ? null : "org-id",
			config: values.config,
		});
	}

	async function completions() {
		return await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: "Bearer real-token",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: "vertex-anthropic/claude-haiku-4-5",
				messages: [{ role: "user", content: "Hi" }],
			}),
		});
	}

	test("retries an env credential with a minted access token", async () => {
		await seedApiKey("credits");
		vi.stubEnv(PROJECT_ENV, "env-project");
		vi.stubEnv(
			SA_ENV,
			[
				serviceAccount("env-a", "sa-project"),
				serviceAccount("env-b", "sa-project"),
			].join(","),
		);
		const calls = mockUpstream();

		const res = await completions();

		expect(res.status).toBe(200);
		expect(calls).toHaveLength(2);
		expect(calls.map((call) => call.authorization)).toEqual([
			`Bearer ${accessTokenFor("env-a")}`,
			`Bearer ${accessTokenFor("env-b")}`,
		]);
		// The configured project wins over the service account's own.
		for (const call of calls) {
			expect(call.url).toContain("/projects/env-project/");
		}
	});

	test("retries a managed credential with a minted access token", async () => {
		await seedApiKey("credits");
		vi.stubEnv(SA_ENV, undefined);
		for (const name of ["managed-a", "managed-b"]) {
			await seedProviderKey({
				id: name,
				token: serviceAccount(name, "managed-sa-project"),
				managed: true,
				config: { project: "managed-project", region: "global" },
			});
		}
		const calls = mockUpstream();

		const res = await completions();

		expect(res.status).toBe(200);
		expect(calls).toHaveLength(2);
		expect(new Set(calls.map((call) => call.authorization))).toEqual(
			new Set([
				`Bearer ${accessTokenFor("managed-a")}`,
				`Bearer ${accessTokenFor("managed-b")}`,
			]),
		);
		for (const call of calls) {
			expect(call.url).toContain("/projects/managed-project/");
		}
	});

	test("sends a provider key's own access token and project", async () => {
		await seedApiKey("api-keys");
		vi.stubEnv(SA_ENV, serviceAccount("platform", "platform-project"));
		vi.stubEnv(PROJECT_ENV, "platform-project");
		for (const name of ["byok-a", "byok-b"]) {
			await seedProviderKey({
				id: name,
				token: serviceAccount(name, "byok-project"),
				managed: false,
			});
		}
		const calls = mockUpstream();

		const res = await completions();

		expect(res.status).toBe(200);
		expect(calls).toHaveLength(2);
		expect(new Set(calls.map((call) => call.authorization))).toEqual(
			new Set([
				`Bearer ${accessTokenFor("byok-a")}`,
				`Bearer ${accessTokenFor("byok-b")}`,
			]),
		);
		for (const call of calls) {
			expect(call.url).toContain("/projects/byok-project/");
		}
	});
});
