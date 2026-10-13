import { HTTPException } from "hono/http-exception";

import { and, db, eq, inArray, isNotNull, tables } from "@llmgateway/db";
import {
	CONTEXT_TIER_TOLERANCE,
	getContextSizeDeviation,
	getReferenceContextSize,
} from "@llmgateway/models";

interface ListedWindow {
	modelId: string;
	providerId: string;
	contextSize: number | null;
	deactivatedAt: Date | null;
}

async function listedWindows(modelIds: string[]): Promise<ListedWindow[]> {
	if (modelIds.length === 0) {
		return [];
	}
	return await db
		.select({
			modelId: tables.modelProviderMapping.modelId,
			providerId: tables.modelProviderMapping.providerId,
			contextSize: tables.modelProviderMapping.contextSize,
			deactivatedAt: tables.modelProviderMapping.deactivatedAt,
		})
		.from(tables.modelProviderMapping)
		.where(
			and(
				inArray(tables.modelProviderMapping.modelId, modelIds),
				eq(tables.modelProviderMapping.status, "active"),
				isNotNull(tables.modelProviderMapping.contextSize),
			),
		);
}

function largestOtherWindow(
	windows: ListedWindow[],
	modelId: string,
	providerId: string,
	now: Date,
): number | undefined {
	let largest: number | undefined;
	for (const window of windows) {
		if (
			window.modelId === modelId &&
			window.providerId !== providerId &&
			(!window.deactivatedAt || window.deactivatedAt > now) &&
			(window.contextSize ?? 0) > (largest ?? 0)
		) {
			largest = window.contextSize ?? undefined;
		}
	}
	return largest;
}

/**
 * Reference windows for many listings at once: the catalogue's largest window,
 * or for models outside it the largest window other carriers list. The
 * listing's own provider is excluded so an edit is not compared with itself.
 */
export async function referenceContextSizes(
	listings: { modelName: string }[],
): Promise<(modelName: string, providerId: string) => number | undefined> {
	const outsideCatalogue = [
		...new Set(
			listings
				.map((listing) => listing.modelName)
				.filter(
					(modelName) => getReferenceContextSize(modelName) === undefined,
				),
		),
	];
	const windows = await listedWindows(outsideCatalogue);
	const now = new Date();
	return (modelName, providerId) =>
		getReferenceContextSize(modelName) ??
		largestOtherWindow(windows, modelName, providerId, now);
}

/**
 * Listings must declare a context window within the routing tolerance of the
 * model's reference window: a smaller one would only serve pinned requests, a
 * larger one claims more than any other deployment of the model.
 */
export async function assertListingContextSize(
	modelName: string,
	providerId: string,
	contextSize: number | null | undefined,
): Promise<void> {
	const reference = (await referenceContextSizes([{ modelName }]))(
		modelName,
		providerId,
	);
	if (reference === undefined) {
		return;
	}
	const tokens = (count: number) => count.toLocaleString("en-US");
	const tolerance = `${CONTEXT_TIER_TOLERANCE * 100}%`;
	if (!contextSize) {
		throw new HTTPException(400, {
			message: `Enter the context size your deployment accepts. ${modelName} is served with up to ${tokens(reference)} tokens.`,
		});
	}
	const deviation = getContextSizeDeviation(contextSize, reference);
	if (deviation === "below") {
		throw new HTTPException(400, {
			message: `A context size of ${tokens(contextSize)} tokens is more than ${tolerance} below the ${tokens(reference)} tokens ${modelName} is served with. Listings must serve the model's full context window.`,
		});
	}
	if (deviation === "above") {
		throw new HTTPException(400, {
			message: `A context size of ${tokens(contextSize)} tokens is more than ${tolerance} above the ${tokens(reference)} tokens ${modelName} is served with elsewhere. Declare the window your deployment accepts.`,
		});
	}
}
