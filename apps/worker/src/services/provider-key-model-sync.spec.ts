import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { getModelIdsByProvider } from "@llmgateway/shared";

import { syncProviderKeyModels } from "./provider-key-model-sync.js";

import type { ProviderKeyModelProbeResult } from "@llmgateway/actions";

const originalHashSecret = process.env.GATEWAY_API_KEY_HASH_SECRET;
const bedrockModels = getModelIdsByProvider().get("aws-bedrock") ?? [];
const [allowedModel, workingModel] = bedrockModels;

async function createKey(
	values: { provider?: string; allowedModels?: string[] | null } = {},
) {
	const id = `model-sync-key-${randomUUID()}`;
	await db.insert(tables.providerKey).values({
		id,
		provider: values.provider ?? "aws-bedrock",
		...encryptProviderKeyForStorage("managed-provider-key", id, null),
		managed: true,
		allowedModels:
			values.allowedModels === undefined
				? [allowedModel]
				: values.allowedModels,
	});
	return id;
}

async function allowedModelsOf(id: string) {
	const [row] = await db
		.select({ allowedModels: tables.providerKey.allowedModels })
		.from(tables.providerKey)
		.where(eq(tables.providerKey.id, id));
	return row?.allowedModels;
}

async function historyOf(id: string) {
	return await db
		.select()
		.from(tables.platformAuditLog)
		.where(eq(tables.platformAuditLog.resourceId, id));
}

// Only `workingModel` has become available on the account.
const probe = vi.fn(
	async ({
		modelId,
	}: {
		modelId: string;
	}): Promise<ProviderKeyModelProbeResult> =>
		modelId === workingModel
			? { model: modelId, inCatalog: true, valid: true }
			: {
					model: modelId,
					inCatalog: true,
					valid: false,
					statusCode: 404,
					error: "model not enabled",
				},
);

describe("syncProviderKeyModels", () => {
	beforeEach(async () => {
		process.env.GATEWAY_API_KEY_HASH_SECRET = "model-sync-test-secret";
		probe.mockClear();
		await db.delete(tables.platformAuditLog);
		await db
			.delete(tables.providerKey)
			.where(eq(tables.providerKey.managed, true));
	});

	afterEach(async () => {
		await db.delete(tables.platformAuditLog);
		await db
			.delete(tables.providerKey)
			.where(eq(tables.providerKey.managed, true));
		if (originalHashSecret === undefined) {
			delete process.env.GATEWAY_API_KEY_HASH_SECRET;
		} else {
			process.env.GATEWAY_API_KEY_HASH_SECRET = originalHashSecret;
		}
	});

	it("enables newly working models and records the run", async () => {
		expect(bedrockModels.length).toBeGreaterThan(2);
		const id = await createKey();

		expect(await syncProviderKeyModels({ probe })).toBe(1);

		expect(await allowedModelsOf(id)).toEqual([allowedModel, workingModel]);
		// Already-allowed models are never re-tested, so they cannot be removed.
		expect(
			probe.mock.calls.some(([options]) => options.modelId === allowedModel),
		).toBe(false);

		const [entry] = await historyOf(id);
		expect(entry?.action).toBe("provider_key.models_synced");
		expect(entry?.userId).toBeNull();
		expect(entry?.metadata?.added).toEqual([workingModel]);
		expect(entry?.metadata?.probed).toBe(bedrockModels.length - 1);
		expect(entry?.metadata?.failed).toContainEqual({
			model: bedrockModels[2],
			statusCode: 404,
			error: "model not enabled",
		});
	});

	it("syncs a credential at most once a day", async () => {
		const id = await createKey();

		expect(await syncProviderKeyModels({ probe })).toBe(1);
		probe.mockClear();
		expect(await syncProviderKeyModels({ probe })).toBe(0);

		expect(probe).not.toHaveBeenCalled();
		expect(await historyOf(id)).toHaveLength(1);
	});

	it("skips unrestricted credentials and other providers", async () => {
		const unrestricted = await createKey({ allowedModels: null });
		const openaiModels = getModelIdsByProvider().get("openai") ?? [];
		const other = await createKey({
			provider: "openai",
			allowedModels: [openaiModels[0]!],
		});

		expect(await syncProviderKeyModels({ probe })).toBe(0);

		expect(probe).not.toHaveBeenCalled();
		expect(await allowedModelsOf(unrestricted)).toBeNull();
		expect(await allowedModelsOf(other)).toEqual([openaiModels[0]]);
	});

	it("does not restrict a credential whose restriction was cleared mid-run", async () => {
		const id = await createKey();

		await syncProviderKeyModels({
			probe,
			onProgress: async () => {
				await db
					.update(tables.providerKey)
					.set({ allowedModels: null })
					.where(eq(tables.providerKey.id, id));
			},
		});

		expect(await allowedModelsOf(id)).toBeNull();
		expect(await historyOf(id)).toHaveLength(0);
	});
});
