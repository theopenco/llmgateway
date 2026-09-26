import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import {
	encryptClaimVerificationKey,
	encryptProviderKeyForStorage,
} from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";

interface Entry {
	mappingId: string | null;
	draftModelId: string | null;
	providerId: string;
	modelName: string;
	region: string | null;
	initiatedBy: "carrier" | "admin";
	credentialSource: "supplied" | "carrier" | "managed" | "environment";
	verification: {
		id: string;
		status: "queued" | "running" | "passed" | "failed";
		checks: { id: string; label: string; status: string }[];
		summary: string | null;
	};
}

interface HistoryEntry {
	id: string;
	status: string;
	summary: string | null;
	initiatedBy: "carrier" | "admin";
	actorName: string | null;
	actorEmail: string | null;
}

describe("admin model verifications", () => {
	let cookie: string;

	// `deleteAll` leaves the catalogue tables alone, so this spec owns the rows
	// it seeds.
	async function removeSeededCatalogue() {
		await db
			.delete(tables.modelProviderMapping)
			.where(eq(tables.modelProviderMapping.id, "mv-mapping"));
		await db.delete(tables.model).where(eq(tables.model.id, "mv-model"));
	}

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await removeSeededCatalogue();

		await db
			.insert(tables.provider)
			.values({ id: "openai", name: "OpenAI", description: "OpenAI" })
			.onConflictDoNothing();
		await db
			.insert(tables.model)
			.values({ id: "mv-model", name: "mv-model", family: "openai" });
		await db.insert(tables.modelProviderMapping).values({
			id: "mv-mapping",
			modelId: "mv-model",
			providerId: "openai",
			externalId: "mv-external",
			streaming: true,
			tools: true,
			vision: false,
			jsonOutput: true,
			jsonOutputSchema: false,
			reasoning: false,
			webSearch: false,
		});
		await db.insert(tables.providerKey).values({
			id: "mv-managed-key",
			...encryptProviderKeyForStorage("sk-managed", "mv-managed-key", null),
			provider: "openai",
			managed: true,
			organizationId: null,
		});
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await removeSeededCatalogue();
		await deleteAll();
	});

	async function queue(body: Record<string, unknown>) {
		return await app.request("/admin/model-verifications", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: cookie },
			body: JSON.stringify(body),
		});
	}

	test("requires authentication", async () => {
		const res = await app.request("/admin/model-verifications");
		expect(res.status).toBe(401);
	});

	test("queues a run for a catalogue mapping using the managed credential", async () => {
		const res = await queue({ mappingId: "mv-mapping" });
		expect(res.status).toBe(202);
		const { entry } = (await res.json()) as { entry: Entry };
		expect(entry.mappingId).toBe("mv-mapping");
		expect(entry.draftModelId).toBeNull();
		expect(entry.initiatedBy).toBe("admin");
		expect(entry.credentialSource).toBe("managed");
		expect(entry.verification.status).toBe("queued");
		// Capability checks follow the mapping's declared flags.
		const checkIds = entry.verification.checks.map((check) => check.id);
		expect(checkIds).toContain("basic");
		expect(checkIds).toContain("streaming");
		expect(checkIds).toContain("tools");
		expect(checkIds).toContain("json_output");
		expect(checkIds).not.toContain("vision");

		const row = await db.query.providerModelVerification.findFirst({
			where: { id: { eq: entry.verification.id } },
		});
		expect(row?.providerCompanyId).toBeNull();
		expect(row?.credentialCiphertext).toBeNull();
	});

	test("rejects a body without exactly one anchor", async () => {
		expect((await queue({})).status).toBe(400);
		expect(
			(await queue({ mappingId: "mv-mapping", draftModelId: "x" })).status,
		).toBe(400);
	});

	test("404s for an unknown mapping", async () => {
		expect((await queue({ mappingId: "nope" })).status).toBe(404);
	});

	test("refuses a second concurrent run for the same mapping", async () => {
		expect((await queue({ mappingId: "mv-mapping" })).status).toBe(202);
		expect((await queue({ mappingId: "mv-mapping" })).status).toBe(409);
	});

	test("encrypts a supplied key against the admin scope", async () => {
		const res = await queue({ mappingId: "mv-mapping", apiKey: "sk-pasted" });
		expect(res.status).toBe(202);
		const { entry } = (await res.json()) as { entry: Entry };
		expect(entry.credentialSource).toBe("supplied");
		const row = await db.query.providerModelVerification.findFirst({
			where: { id: { eq: entry.verification.id } },
		});
		expect(row?.credentialCiphertext).toBeTruthy();
		expect(row?.credentialCiphertext).not.toContain("sk-pasted");
	});

	test("runs a claimed provider on the carrier's saved key", async () => {
		const [company] = await db
			.insert(tables.providerCompany)
			.values({ name: "OpenAI Ops" })
			.returning();
		const [claim] = await db
			.insert(tables.providerClaim)
			.values({
				providerCompanyId: company.id,
				providerId: "openai",
				matchedDomain: "openai.com",
				status: "active",
			})
			.returning();

		// A carrier owns this provider but has saved no key yet, so the run must
		// not silently fall back to our managed credential.
		const unkeyed = await queue({ mappingId: "mv-mapping" });
		expect(unkeyed.status).toBe(400);
		expect((await unkeyed.json()).message).toContain("provider API key");

		await db
			.update(tables.providerClaim)
			.set({
				verificationKeyCiphertext: encryptClaimVerificationKey(
					"carrier-owned-key",
					claim.id,
					company.id,
				),
				verificationKeyMasked: "sk-car••••key",
				verificationKeyUpdatedAt: new Date(),
			})
			.where(eq(tables.providerClaim.id, claim.id));

		const res = await queue({ mappingId: "mv-mapping" });
		expect(res.status).toBe(202);
		const { entry } = (await res.json()) as { entry: Entry };
		expect(entry.credentialSource).toBe("carrier");
		const row = await db.query.providerModelVerification.findFirst({
			where: { id: { eq: entry.verification.id } },
		});
		expect(row?.credentialCiphertext).toMatch(/^llmgw:v2:/);
		expect(row?.credentialCiphertext).not.toContain("carrier-owned-key");
	});

	test("lists the latest run per mapping for a provider", async () => {
		const first = (await (await queue({ mappingId: "mv-mapping" })).json()) as {
			entry: Entry;
		};
		// Settle the first run so a second one can be queued.
		await db
			.update(tables.providerModelVerification)
			.set({ status: "passed", summary: "ok" })
			.where(
				eq(tables.providerModelVerification.id, first.entry.verification.id),
			);

		const res = await app.request(
			"/admin/model-verifications?providerId=openai",
			{ headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { entries: Entry[] };
		expect(body.entries).toHaveLength(1);
		expect(body.entries[0].mappingId).toBe("mv-mapping");
	});

	test("lists every past run for a mapping with who triggered it", async () => {
		const first = (await (await queue({ mappingId: "mv-mapping" })).json()) as {
			entry: Entry;
		};
		await db
			.update(tables.providerModelVerification)
			.set({ status: "failed", summary: "vision failed" })
			.where(
				eq(tables.providerModelVerification.id, first.entry.verification.id),
			);
		const second = (await (
			await queue({ mappingId: "mv-mapping" })
		).json()) as {
			entry: Entry;
		};

		const res = await app.request(
			"/admin/model-verifications/history?mappingId=mv-mapping",
			{ headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { entries: HistoryEntry[] };
		expect(body.entries.map((entry) => entry.id)).toEqual([
			second.entry.verification.id,
			first.entry.verification.id,
		]);
		expect(body.entries[1].status).toBe("failed");
		expect(body.entries[1].summary).toBe("vision failed");
		expect(body.entries[0].initiatedBy).toBe("admin");
		expect(body.entries[0].actorName).toBe("Test User");
		expect(body.entries[0].actorEmail).toBe("admin@example.com");
	});

	test("history needs exactly one anchor", async () => {
		const res = await app.request("/admin/model-verifications/history", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(400);
	});

	test("cancels a queued run and frees the mapping", async () => {
		const { entry } = (await (
			await queue({ mappingId: "mv-mapping" })
		).json()) as { entry: Entry };
		const res = await app.request(
			`/admin/model-verifications/${entry.verification.id}/cancel`,
			{ method: "POST", headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(200);
		const cancelled = (await res.json()) as { entry: Entry };
		expect(cancelled.entry.verification.status).toBe("failed");
		expect(
			cancelled.entry.verification.checks.every(
				(check) => check.status !== "queued",
			),
		).toBe(true);
		expect((await queue({ mappingId: "mv-mapping" })).status).toBe(202);
	});
});
