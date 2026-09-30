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
	modelId: string | null;
}

interface ErrorsBody {
	errors: { statusCode: number | null; count: number }[];
	sampledErrors: number;
}

interface ScopeOptionsBody {
	modelIds: { id: string; source: string }[];
	mappings: { id: string; source: string }[];
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
		createdAt,
	}: {
		providerKeyId?: string | null;
		hasError?: boolean;
		statusCode?: number;
		usedModel?: string;
		usedProvider?: string;
		classification?: "client_error" | "gateway_error" | "upstream_error";
		createdAt?: Date;
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
			...(createdAt ? { createdAt } : {}),
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

	test("drilldown groups error shapes per provider key", async () => {
		await seedMixedTraffic();
		await seedLog({
			providerKeyId: "um-key-a",
			hasError: true,
			statusCode: 502,
		});
		await seedLog({
			providerKeyId: "um-key-a",
			hasError: true,
			statusCode: 500,
		});

		async function getErrors(extra: string) {
			const res = await app.request(
				`/admin/unstable-mappings/errors?model=openai/gpt-4o-mini&provider=openai&includeByok=true${extra}`,
				{ headers: { Cookie: cookie } },
			);
			expect(res.status).toBe(200);
			return (await res.json()) as ErrorsBody & {
				groupByKey: boolean;
				keys: {
					providerKeyId: string | null;
					providerKeyLabel: string | null;
					errorsCount: number;
				}[];
			};
		}

		const grouped = await getErrors("&groupByKey=true");
		expect(grouped.groupByKey).toBe(true);
		expect(grouped.sampledErrors).toBe(5);
		expect(grouped.keys).toEqual([
			expect.objectContaining({
				providerKeyId: "um-key-a",
				providerKeyLabel: "Primary account",
				errorsCount: 3,
			}),
			expect.objectContaining({
				providerKeyId: "um-key-b",
				providerKeyLabel: "Customer production",
				errorsCount: 1,
			}),
			expect.objectContaining({ providerKeyId: null, errorsCount: 1 }),
		]);
		expect(grouped.errors).toHaveLength(4);
		expect(grouped.errors[0]).toMatchObject({
			providerKeyId: "um-key-a",
			statusCode: 500,
			count: 2,
		});

		// A drilldown already narrowed to one key has nothing to group.
		const narrowed = await getErrors("&groupByKey=true&providerKeyId=um-key-a");
		expect(narrowed.groupByKey).toBe(false);
		expect(narrowed.keys).toEqual([]);
	});

	test("drilldown buckets each error shape across the window", async () => {
		const bucketMs = 60_000;
		const tenBucketsMs = 10 * bucketMs;
		const now = Date.now();
		const currentBucket = Math.floor(now / bucketMs) * bucketMs;
		const olderBucket = currentBucket - tenBucketsMs;
		await seedLog({ hasError: true, createdAt: new Date(now) });
		await seedLog({ hasError: true, createdAt: new Date(olderBucket + 1000) });
		await seedLog({ hasError: true, createdAt: new Date(olderBucket + 2000) });

		const res = await app.request(
			"/admin/unstable-mappings/errors?model=openai/gpt-4o-mini&provider=openai&window=1h",
			{ headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as ErrorsBody & {
			timeline: { bucketSeconds: number; start: number; end: number };
			errors: { buckets: { start: number; count: number }[] }[];
		};
		expect(body.timeline.bucketSeconds).toBe(60);
		const windowMs = 60 * bucketMs;
		expect(body.timeline.end - body.timeline.start).toBe(windowMs);
		expect(body.errors).toHaveLength(1);
		expect(body.errors[0].buckets).toEqual([
			{ start: olderBucket, count: 2 },
			{ start: currentBucket, count: 1 },
		]);
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

	test("filters the ranking to every mapping of a canonical model", async () => {
		await seedLog({ usedModel: "openai/gpt-5.6-sol", hasError: true });
		await seedLog({
			usedModel: "aws-mantle/gpt-5.6-sol:global",
			usedProvider: "aws-mantle",
			hasError: true,
		});
		await seedLog({
			usedModel: "aws-mantle/gpt-5.6-sol:global",
			usedProvider: "aws-mantle",
		});
		await seedLog({ usedModel: "openai/gpt-4o-mini", hasError: true });

		const body = await getMappings("?modelId=gpt-5.6-sol");
		expect(body.modelId).toBe("gpt-5.6-sol");
		expect(body.sampledLogs).toBe(3);
		expect(body.mappings.map((m) => m.usedModel).sort()).toEqual([
			"aws-mantle/gpt-5.6-sol:global",
			"openai/gpt-5.6-sol",
		]);

		const unknown = await getMappings("?modelId=um-unknown-model");
		expect(unknown.sampledLogs).toBe(0);
	});

	test("scope options cover airside listings and the catalogue", async () => {
		const providerId = "um-airside-carrier";
		const modelId = "um-airside-model";
		async function clearAirsideFixtures() {
			await db
				.delete(tables.modelProviderMapping)
				.where(eq(tables.modelProviderMapping.providerId, providerId));
			await db.delete(tables.model).where(eq(tables.model.id, modelId));
			await db
				.delete(tables.provider)
				.where(eq(tables.provider.id, providerId));
		}

		await clearAirsideFixtures();
		await db.insert(tables.provider).values({
			id: providerId,
			name: "UM Airside Carrier",
			description: "test",
		});
		await db.insert(tables.model).values({
			id: modelId,
			name: "UM Airside Model",
			family: "test",
		});
		await db.insert(tables.modelProviderMapping).values([
			{
				id: "um-airside-mapping",
				modelId,
				providerId,
				externalId: modelId,
				source: "airside",
			},
			{
				id: "um-airside-mapping-eu",
				modelId,
				providerId,
				externalId: modelId,
				region: "eu-west",
				source: "airside",
			},
		]);

		try {
			const res = await app.request("/admin/unstable-mappings/scope-options", {
				headers: { Cookie: cookie },
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as ScopeOptionsBody;

			expect(body.mappings).toContainEqual({
				id: `${providerId}/${modelId}`,
				source: "airside",
			});
			// Regional listings are addressable: the filter matches `used_model`.
			expect(body.mappings).toContainEqual({
				id: `${providerId}/${modelId}:eu-west`,
				source: "airside",
			});
			expect(body.modelIds).toContainEqual({
				id: modelId,
				source: "airside",
			});
			expect(body.mappings).toContainEqual({
				id: "openai/gpt-4o-mini",
				source: "catalogue",
			});
		} finally {
			await clearAirsideFixtures();
		}
	});
});
