import { isStopRequested } from "@/shutdown.js";

import {
	decryptProviderKey,
	getRequiredChecksForModel,
	runProviderEndpointChecks,
} from "@llmgateway/actions";
import {
	and,
	db,
	eq,
	tables,
	type ProviderListingCheckResult,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

/**
 * Claims and processes the oldest queued provider-listing validation run:
 * probes the applicant's OpenAI-compatible endpoint with the check suite for
 * every claimed model, appending results after each model so the dashboard
 * can poll progress. The run passes when every required check passes;
 * optional checks (a capability the catalogue model does not declare) are
 * recorded but do not affect the verdict.
 */
export async function processQueuedProviderListingRuns(): Promise<void> {
	const candidate = await db.query.providerListingTestRun.findFirst({
		where: { status: "queued" },
		orderBy: { createdAt: "asc" },
	});
	if (!candidate) {
		return;
	}

	// Optimistic claim: only one worker wins the queued -> running transition.
	const [run] = await db
		.update(tables.providerListingTestRun)
		.set({ status: "running", startedAt: new Date() })
		.where(
			and(
				eq(tables.providerListingTestRun.id, candidate.id),
				eq(tables.providerListingTestRun.status, "queued"),
			),
		)
		.returning();
	if (!run) {
		return;
	}

	await db
		.update(tables.providerListingRequest)
		.set({ validationStatus: "running" })
		.where(eq(tables.providerListingRequest.id, run.listingRequestId));

	const failRun = async (error: string) => {
		await db
			.update(tables.providerListingTestRun)
			.set({ status: "failed", completedAt: new Date(), error })
			.where(eq(tables.providerListingTestRun.id, run.id));
		await db
			.update(tables.providerListingRequest)
			.set({ validationStatus: "failed" })
			.where(eq(tables.providerListingRequest.id, run.listingRequestId));
	};

	const listing = await db.query.providerListingRequest.findFirst({
		where: { id: run.listingRequestId },
	});
	if (!listing) {
		await failRun("Listing no longer exists");
		return;
	}
	if (
		!listing.baseUrl ||
		!listing.testKeyCiphertext ||
		!listing.organizationId ||
		!listing.claimedModels?.length
	) {
		await failRun("Listing is missing an endpoint, test key, or models");
		return;
	}

	let token: string;
	try {
		token = decryptProviderKey(
			listing.testKeyCiphertext,
			listing.id,
			listing.organizationId,
		);
	} catch (error) {
		logger.error(
			"Failed to decrypt provider listing test key",
			error instanceof Error ? error : new Error(String(error)),
		);
		await failRun("Stored test credential could not be read");
		return;
	}

	logger.info("Starting provider listing validation run", {
		runId: run.id,
		listingId: listing.id,
		models: listing.claimedModels.length,
	});

	const results: ProviderListingCheckResult[] = [];
	try {
		for (const claimed of listing.claimedModels) {
			if (isStopRequested()) {
				// Requeue so a deploy mid-run does not strand it half-finished.
				await db
					.update(tables.providerListingTestRun)
					.set({ status: "queued", startedAt: null, results: [] })
					.where(eq(tables.providerListingTestRun.id, run.id));
				await db
					.update(tables.providerListingRequest)
					.set({ validationStatus: "queued" })
					.where(eq(tables.providerListingRequest.id, listing.id));
				return;
			}

			const required = getRequiredChecksForModel(claimed.modelId);
			const checkResults = await runProviderEndpointChecks({
				baseUrl: listing.baseUrl,
				token,
				externalModelId: claimed.externalId,
			});
			for (const result of checkResults) {
				results.push({
					modelId: claimed.modelId,
					externalId: claimed.externalId,
					check: result.check,
					passed: result.passed,
					required: required.includes(result.check),
					latencyMs: result.latencyMs,
					error: result.error,
				});
			}
			await db
				.update(tables.providerListingTestRun)
				.set({ results })
				.where(eq(tables.providerListingTestRun.id, run.id));
		}
	} catch (error) {
		// runProviderEndpointChecks only throws on an unsafe/unresolvable base
		// URL; individual probe failures come back as failed results.
		logger.warn("Provider listing validation aborted", {
			runId: run.id,
			error: error instanceof Error ? error.message : String(error),
		});
		await failRun(
			error instanceof Error ? error.message : "Validation aborted",
		);
		return;
	}

	const passed = results.filter((r) => r.required).every((r) => r.passed);
	await db
		.update(tables.providerListingTestRun)
		.set({
			status: passed ? "passed" : "failed",
			completedAt: new Date(),
			results,
		})
		.where(eq(tables.providerListingTestRun.id, run.id));
	await db
		.update(tables.providerListingRequest)
		.set({ validationStatus: passed ? "passed" : "failed" })
		.where(eq(tables.providerListingRequest.id, listing.id));

	logger.info("Provider listing validation run finished", {
		runId: run.id,
		listingId: listing.id,
		passed,
		checks: results.length,
		failedChecks: results.filter((r) => !r.passed).length,
	});
}
