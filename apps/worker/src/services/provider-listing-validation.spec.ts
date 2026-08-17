import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { db, eq, tables } from "@llmgateway/db";

import { processQueuedProviderListingRuns } from "./provider-listing-validation.js";

import type * as ActionsModule from "@llmgateway/actions";

vi.mock("@llmgateway/actions", async (importOriginal) => {
	const actual = await importOriginal<typeof ActionsModule>();
	return {
		...actual,
		decryptProviderKey: vi.fn(() => "sk-decrypted-test-key"),
		runProviderEndpointChecks: vi.fn(),
	};
});

const { runProviderEndpointChecks } = vi.mocked(
	await import("@llmgateway/actions"),
);

const ORG_ID = "org-listing-validation";
const LISTING_ID = "listing-validation-test";

const passingChecks = [
	{ check: "chat" as const, passed: true, latencyMs: 420 },
	{ check: "streaming" as const, passed: true, latencyMs: 900 },
	{ check: "json_mode" as const, passed: true, latencyMs: 500 },
	{ check: "tool_calls" as const, passed: true, latencyMs: 610 },
];

async function seedListing(overrides: Record<string, unknown> = {}) {
	await db.insert(tables.organization).values({
		id: ORG_ID,
		name: "Validation Org",
		billingEmail: "validation@acme.test",
	});
	await db.insert(tables.providerListingRequest).values({
		id: LISTING_ID,
		organizationId: ORG_ID,
		providerName: "Acme Inference",
		providerSlug: "acme-inference",
		email: "validation@acme.test",
		url: "https://acme.test",
		country: "Germany",
		paymentStatus: "paid",
		baseUrl: "https://api.acme.test",
		testKeyCiphertext: "llmgw:v2:test:ciphertext:tag",
		claimedModels: [{ modelId: "gpt-5-mini", externalId: "acme-gpt-5-mini" }],
		validationStatus: "queued",
		...overrides,
	});
	const [run] = await db
		.insert(tables.providerListingTestRun)
		.values({ listingRequestId: LISTING_ID })
		.returning();
	return run;
}

async function cleanup() {
	await db.delete(tables.providerListingTestRun);
	await db.delete(tables.providerListingRequest);
	await db.delete(tables.organization);
}

describe("processQueuedProviderListingRuns", () => {
	beforeEach(async () => {
		await cleanup();
		runProviderEndpointChecks.mockReset();
	});

	afterEach(async () => {
		await cleanup();
	});

	test("passes a run when every required check passes", async () => {
		const run = await seedListing();
		runProviderEndpointChecks.mockResolvedValue(passingChecks);

		await processQueuedProviderListingRuns();

		const updated = await db.query.providerListingTestRun.findFirst({
			where: { id: run.id },
		});
		expect(updated?.status).toBe("passed");
		expect(updated?.completedAt).toBeTruthy();
		expect(updated?.results).toHaveLength(4);
		expect(updated?.results[0]).toMatchObject({
			modelId: "gpt-5-mini",
			externalId: "acme-gpt-5-mini",
			passed: true,
		});

		const listing = await db.query.providerListingRequest.findFirst({
			where: { id: LISTING_ID },
		});
		expect(listing?.validationStatus).toBe("passed");
	});

	test("fails the run when a required check fails", async () => {
		const run = await seedListing();
		runProviderEndpointChecks.mockResolvedValue([
			...passingChecks.slice(0, 1),
			{
				check: "streaming",
				passed: false,
				latencyMs: 30_000,
				error: "Stream did not terminate with data: [DONE]",
			},
			...passingChecks.slice(2),
		]);

		await processQueuedProviderListingRuns();

		const updated = await db.query.providerListingTestRun.findFirst({
			where: { id: run.id },
		});
		expect(updated?.status).toBe("failed");

		const listing = await db.query.providerListingRequest.findFirst({
			where: { id: LISTING_ID },
		});
		expect(listing?.validationStatus).toBe("failed");
	});

	test("a failing optional check does not fail the run", async () => {
		const run = await seedListing({
			// web-search style model id that exists but declares no tools/json on
			// any mapping is hard to pin; instead claim a model and rely on the
			// required flag computed from the catalogue. Use an unknown model id:
			// required checks fall back to chat + streaming only.
			claimedModels: [
				{ modelId: "model-not-in-catalogue", externalId: "acme-x" },
			],
		});
		runProviderEndpointChecks.mockResolvedValue([
			{ check: "chat", passed: true, latencyMs: 400 },
			{ check: "streaming", passed: true, latencyMs: 800 },
			{ check: "json_mode", passed: false, latencyMs: 300, error: "400" },
			{ check: "tool_calls", passed: false, latencyMs: 300, error: "400" },
		]);

		await processQueuedProviderListingRuns();

		const updated = await db.query.providerListingTestRun.findFirst({
			where: { id: run.id },
		});
		expect(updated?.status).toBe("passed");
		const optional = updated?.results.filter((r) => !r.required) ?? [];
		expect(optional.map((r) => r.check).sort()).toEqual([
			"json_mode",
			"tool_calls",
		]);
	});

	test("fails the run when the base URL is rejected by the SSRF guard", async () => {
		const run = await seedListing();
		runProviderEndpointChecks.mockRejectedValue(
			new Error("Provider base URL must use https"),
		);

		await processQueuedProviderListingRuns();

		const updated = await db.query.providerListingTestRun.findFirst({
			where: { id: run.id },
		});
		expect(updated?.status).toBe("failed");
		expect(updated?.error).toContain("https");
	});

	test("fails cleanly when the listing is missing required fields", async () => {
		const run = await seedListing({ baseUrl: null });

		await processQueuedProviderListingRuns();

		const updated = await db.query.providerListingTestRun.findFirst({
			where: { id: run.id },
		});
		expect(updated?.status).toBe("failed");
		expect(runProviderEndpointChecks).not.toHaveBeenCalled();
	});

	test("does nothing when no run is queued", async () => {
		await processQueuedProviderListingRuns();
		expect(runProviderEndpointChecks).not.toHaveBeenCalled();
	});

	test("requeues and processes a run stranded by a dead worker", async () => {
		const run = await seedListing({ validationStatus: "running" });
		await db
			.update(tables.providerListingTestRun)
			.set({
				status: "running",
				startedAt: new Date(Date.now() - 3_600_000),
			})
			.where(eq(tables.providerListingTestRun.id, run.id));
		runProviderEndpointChecks.mockResolvedValue(passingChecks);

		await processQueuedProviderListingRuns();

		const updated = await db.query.providerListingTestRun.findFirst({
			where: { id: run.id },
		});
		expect(updated?.status).toBe("passed");
	});

	test("does not requeue a run that is legitimately in progress", async () => {
		const run = await seedListing({ validationStatus: "running" });
		await db
			.update(tables.providerListingTestRun)
			.set({ status: "running", startedAt: new Date() })
			.where(eq(tables.providerListingTestRun.id, run.id));

		await processQueuedProviderListingRuns();

		const updated = await db.query.providerListingTestRun.findFirst({
			where: { id: run.id },
		});
		expect(updated?.status).toBe("running");
		expect(runProviderEndpointChecks).not.toHaveBeenCalled();
	});

	test("voids the verdict when the listing changed mid-run", async () => {
		const run = await seedListing();
		runProviderEndpointChecks.mockImplementation(async () => {
			// Swap the endpoint while the probes are "running".
			await db
				.update(tables.providerListingRequest)
				.set({ baseUrl: "https://swapped.acme.test" })
				.where(eq(tables.providerListingRequest.id, LISTING_ID));
			return passingChecks;
		});

		await processQueuedProviderListingRuns();

		const updated = await db.query.providerListingTestRun.findFirst({
			where: { id: run.id },
		});
		expect(updated?.status).toBe("failed");
		expect(updated?.error).toContain("changed");

		const listing = await db.query.providerListingRequest.findFirst({
			where: { id: LISTING_ID },
		});
		expect(listing?.validationStatus).toBe("failed");
	});
});
