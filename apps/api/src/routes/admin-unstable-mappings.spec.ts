import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

interface MappingEntry {
	usedModel: string;
	providerId: string;
	providerKeyId: string | null;
	providerKeyLabel: string | null;
	providerKeyManaged: boolean | null;
	logsCount: number;
	errorsCount: number;
	errorRate: number;
}

interface ListBody {
	mappings: MappingEntry[];
	sampledLogs: number;
	splitByKey: boolean;
	includeByok: boolean;
	mapping: string | null;
}

interface ErrorsBody {
	errors: { statusCode: number | null; count: number }[];
	sampledErrors: number;
}

describe("admin unstable mappings", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();

		await db.insert(tables.organization).values({
			id: "um-org",
			name: "UM Org",
			billingEmail: "um@example.com",
		});
		await db.insert(tables.project).values({
			id: "um-project",
			name: "UM Project",
			organizationId: "um-org",
			mode: "credits",
		});
		await db.insert(tables.apiKey).values({
			id: "um-api-key",
			...hashApiKeyForStorage("um-api-key-token"),
			projectId: "um-project",
			description: "UM Key",
			createdBy: "test-user-id",
		});
		await db.insert(tables.providerKey).values([
			{
				id: "um-key-a",
				...encryptProviderKeyForStorage("sk-um-key-a", "um-key-a", null),
				provider: "openai",
				managed: true,
				organizationId: null,
				comment: "Primary account",
			},
			{
				id: "um-key-b",
				...encryptProviderKeyForStorage(
					"sk-um-key-bbbb1234",
					"um-key-b",
					"um-org",
				),
				provider: "openai",
				managed: false,
				organizationId: "um-org",
				description: "Customer production",
			},
		]);
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await deleteAll();
	});

	let logIndex = 0;
	async function seedLog({
		providerKeyId = null,
		hasError = false,
		statusCode = 500,
		classification,
		usedModel = "openai/gpt-4o-mini",
		usedProvider = "openai",
	}: {
		providerKeyId?: string | null;
		hasError?: boolean;
		statusCode?: number;
		usedModel?: string;
		usedProvider?: string;
		classification?: "client_error" | "gateway_error" | "upstream_error";
	}) {
		logIndex++;
		await db.insert(tables.log).values({
			id: `um-log-${logIndex}`,
			requestId: `um-request-${logIndex}`,
			organizationId: "um-org",
			projectId: "um-project",
			apiKeyId: "um-api-key",
			providerKeyId,
			hasError,
			unifiedFinishReason: classification,
			errorDetails: hasError
				? {
						statusCode,
						statusText: "err",
						responseText: `failed ${statusCode}`,
					}
				: null,
			duration: 100,
			usedMode: providerKeyId === "um-key-b" ? "api-keys" : "credits",
			requestedModel: usedModel,
			requestedProvider: usedProvider,
			usedModel,
			usedProvider,
			responseSize: 10,
			mode: "credits",
		});
	}

	async function seedMixedTraffic() {
		// Key A: 2 logs, 1 error; key B: 1 log, 1 error; env/unattributed: 1 error.
		await seedLog({ providerKeyId: "um-key-a" });
		await seedLog({
			providerKeyId: "um-key-a",
			hasError: true,
			statusCode: 500,
		});
		await seedLog({
			providerKeyId: "um-key-b",
			hasError: true,
			statusCode: 429,
		});
		await seedLog({ providerKeyId: null, hasError: true, statusCode: 503 });
	}

	async function getMappings(query = ""): Promise<ListBody> {
		const res = await app.request(`/admin/unstable-mappings${query}`, {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		return (await res.json()) as ListBody;
	}

	test("requires authentication", async () => {
		const res = await app.request("/admin/unstable-mappings");
		expect(res.status).toBe(401);
	});

	test("excludes BYOK traffic by default", async () => {
		await seedMixedTraffic();

		const body = await getMappings();
		expect(body.splitByKey).toBe(false);
		expect(body.includeByok).toBe(false);
		expect(body.mappings).toHaveLength(1);
		const [mapping] = body.mappings;
		expect(mapping.logsCount).toBe(3);
		expect(mapping.errorsCount).toBe(2);
		expect(mapping.providerKeyId).toBeNull();
		expect(mapping.providerKeyLabel).toBeNull();
		expect(mapping.providerKeyManaged).toBeNull();
	});

	test("includes BYOK traffic when requested", async () => {
		await seedMixedTraffic();

		const body = await getMappings("?includeByok=true");
		expect(body.includeByok).toBe(true);
		expect(body.mappings[0].logsCount).toBe(4);
		expect(body.mappings[0].errorsCount).toBe(3);
	});

	test("excludes client errors from stability rankings", async () => {
		await seedLog({
			hasError: true,
			statusCode: 400,
			classification: "client_error",
		});
		await seedLog({ hasError: false });

		const body = await getMappings();
		expect(body.mappings).toHaveLength(0);
	});

	test("includes BYOK speech failures only when BYOK traffic is requested", async () => {
		await db
			.update(tables.providerKey)
			.set({ provider: "alibaba" })
			.where(eq(tables.providerKey.id, "um-key-b"));
		const usedModel = "alibaba/qwen-audio-3.0-tts-flash";
		await seedLog({
			usedModel,
			usedProvider: "alibaba",
			providerKeyId: "um-key-b",
			hasError: true,
			statusCode: 200,
			classification: "upstream_error",
		});

		for (const includeByok of [false, true]) {
			const query = `ignoreExpected=false&includeByok=${includeByok}`;
			const body = await getMappings(`?${query}`);
			expect(body.mappings).toHaveLength(includeByok ? 1 : 0);
			if (includeByok) {
				expect(body.mappings[0]).toMatchObject({
					usedModel,
					providerId: "alibaba",
					logsCount: 1,
					errorsCount: 1,
					errorRate: 1,
				});
			}
			const res = await app.request(
				`/admin/unstable-mappings/errors?model=${usedModel}&provider=alibaba&${query}`,
				{ headers: { Cookie: cookie } },
			);
			expect(res.status).toBe(200);
			const errors = (await res.json()) as ErrorsBody;
			expect(errors.sampledErrors).toBe(includeByok ? 1 : 0);
		}
	});

	test("splits the mapping per provider key with labels", async () => {
		await seedMixedTraffic();

		const body = await getMappings("?splitByKey=true&includeByok=true");
		expect(body.splitByKey).toBe(true);
		expect(body.mappings).toHaveLength(3);

		const byKey = new Map(
			body.mappings.map((entry) => [entry.providerKeyId, entry]),
		);

		const keyA = byKey.get("um-key-a");
		expect(keyA?.logsCount).toBe(2);
		expect(keyA?.errorsCount).toBe(1);
		expect(keyA?.providerKeyLabel).toBe("Primary account");
		expect(keyA?.providerKeyManaged).toBe(true);

		// BYOK descriptions identify the customer's key without exposing it.
		const keyB = byKey.get("um-key-b");
		expect(keyB?.errorsCount).toBe(1);
		expect(keyB?.providerKeyLabel).toBe("Customer production");
		expect(keyB?.providerKeyLabel).not.toBe("sk-um-key-bbbb1234");
		expect(keyB?.providerKeyManaged).toBe(false);

		// Env-served traffic keeps its own bucket instead of vanishing.
		const unattributed = byKey.get(null);
		expect(unattributed?.errorsCount).toBe(1);
		expect(unattributed?.providerKeyLabel).toBeNull();
	});

	test("drilldown narrows to one key or the unattributed bucket", async () => {
		await seedMixedTraffic();

		async function getErrors(extra = ""): Promise<ErrorsBody> {
			const res = await app.request(
				`/admin/unstable-mappings/errors?model=openai/gpt-4o-mini&provider=openai${extra}`,
				{ headers: { Cookie: cookie } },
			);
			expect(res.status).toBe(200);
			return (await res.json()) as ErrorsBody;
		}

		const platformOnly = await getErrors();
		expect(platformOnly.sampledErrors).toBe(2);

		const all = await getErrors("&includeByok=true");
		expect(all.sampledErrors).toBe(3);

		const keyA = await getErrors("&providerKeyId=um-key-a");
		expect(keyA.sampledErrors).toBe(1);
		expect(keyA.errors[0].statusCode).toBe(500);

		const unattributed = await getErrors("&providerKeyId=__unattributed__");
		expect(unattributed.sampledErrors).toBe(1);
		expect(unattributed.errors[0].statusCode).toBe(503);
	});

	test("filters the ranking to one mapping", async () => {
		await seedLog({ hasError: true });
		await seedLog({});
		await seedLog({
			usedModel: "openai/gpt-4o",
			hasError: true,
		});

		const unfiltered = await getMappings();
		expect(unfiltered.mapping).toBeNull();
		expect(unfiltered.mappings).toHaveLength(2);
		expect(unfiltered.sampledLogs).toBe(3);

		const body = await getMappings("?model=openai/gpt-4o-mini&provider=openai");
		expect(body.mapping).toBe("openai/gpt-4o-mini");
		expect(body.mappings).toHaveLength(1);
		expect(body.mappings[0]).toMatchObject({
			usedModel: "openai/gpt-4o-mini",
			logsCount: 2,
			errorsCount: 1,
		});
		expect(body.sampledLogs).toBe(2);
	});
});
