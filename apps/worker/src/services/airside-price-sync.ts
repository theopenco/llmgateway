import { Decimal } from "decimal.js";

import { getStopSignal } from "@/shutdown.js";

import {
	autoApprovedFilingFields,
	readProviderKey,
	updateAirsideMappingPrices,
} from "@llmgateway/actions";
import { and, cdb, db, desc, eq, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { isProviderUrlGuardEnabled } from "@llmgateway/shared";
import { fetchSafeUserUrl } from "@llmgateway/shared/url-safety-node";

type ClaimRow = typeof tables.providerClaim.$inferSelect;
type DraftModelRow = typeof tables.providerDraftModel.$inferSelect;
type PriceFilingRow = typeof tables.providerPriceFiling.$inferSelect;

export type CarrierModelsFetch = (
	url: string,
	init: RequestInit,
) => Promise<Response>;

/** Per-token USD prices a carrier publishes for one model on /v1/models. */
export interface PublishedPrices {
	inputPrice: string;
	outputPrice: string;
	cachedInputPrice?: string;
	requestPrice?: string;
}

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
// Same shape the Airside portal accepts: plain decimal or scientific notation.
const PRICE_PATTERN = /^\d+(\.\d+)?([eE][+-]?\d+)?$/;

export const MODELS_ENDPOINT_FILING_NOTE =
	"Price published on the carrier's /v1/models.";

function parsePrice(value: unknown): string | undefined {
	if (typeof value === "number") {
		return Number.isFinite(value) && value >= 0
			? new Decimal(value).toString()
			: undefined;
	}
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return PRICE_PATTERN.test(trimmed) && Number.isFinite(Number(trimmed))
		? trimmed
		: undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the `pricing` object of each model in an OpenAI-style models list:
 * `prompt` and `completion` are required, `input_cache_read` and `request`
 * optional, all in USD per token (per request for `request`). Models without
 * a complete, well-formed price are left out.
 */
export function parsePublishedPrices(
	payload: unknown,
): Map<string, PublishedPrices> {
	const prices = new Map<string, PublishedPrices>();
	const entries = isRecord(payload) ? payload.data : payload;
	if (!Array.isArray(entries)) {
		return prices;
	}
	for (const entry of entries) {
		if (
			!isRecord(entry) ||
			typeof entry.id !== "string" ||
			!isRecord(entry.pricing)
		) {
			continue;
		}
		const inputPrice = parsePrice(entry.pricing.prompt);
		const outputPrice = parsePrice(entry.pricing.completion);
		if (inputPrice === undefined || outputPrice === undefined) {
			continue;
		}
		const cachedInputPrice = parsePrice(entry.pricing.input_cache_read);
		const requestPrice = parsePrice(entry.pricing.request);
		// A malformed optional price voids the entry rather than silently
		// keeping the old one next to new token prices.
		if (
			(entry.pricing.input_cache_read !== undefined &&
				entry.pricing.input_cache_read !== null &&
				cachedInputPrice === undefined) ||
			(entry.pricing.request !== undefined &&
				entry.pricing.request !== null &&
				requestPrice === undefined)
		) {
			continue;
		}
		prices.set(entry.id, {
			inputPrice,
			outputPrice,
			...(cachedInputPrice !== undefined ? { cachedInputPrice } : {}),
			...(requestPrice !== undefined ? { requestPrice } : {}),
		});
	}
	return prices;
}

function samePrice(left: string | null, right: string | null): boolean {
	if (left === null || right === null) {
		return left === right;
	}
	return new Decimal(left).eq(new Decimal(right));
}

/**
 * The prices a published entry leaves the listing with, or null when nothing
 * changes. Prices the carrier does not publish keep their current value.
 */
export function nextPrices(
	current: Pick<
		PriceFilingRow,
		"inputPrice" | "outputPrice" | "cachedInputPrice" | "requestPrice"
	>,
	published: PublishedPrices,
) {
	const next = {
		inputPrice: published.inputPrice,
		outputPrice: published.outputPrice,
		cachedInputPrice: published.cachedInputPrice ?? current.cachedInputPrice,
		requestPrice: published.requestPrice ?? current.requestPrice,
	};
	return samePrice(current.inputPrice, next.inputPrice) &&
		samePrice(current.outputPrice, next.outputPrice) &&
		samePrice(current.cachedInputPrice, next.cachedInputPrice) &&
		samePrice(current.requestPrice, next.requestPrice)
		? null
		: next;
}

const defaultFetch: CarrierModelsFetch = (url, init) =>
	// The base URL is carrier-supplied: https, public addresses, no redirects.
	isProviderUrlGuardEnabled()
		? fetchSafeUserUrl(url, init)
		: fetch(url, { ...init, redirect: "error" });

async function readCappedJson(response: Response): Promise<unknown> {
	const reader = response.body?.getReader();
	if (!reader) {
		return null;
	}
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		size += value.byteLength;
		if (size > MAX_RESPONSE_BYTES) {
			await reader.cancel();
			throw new Error("The models list is larger than 2 MB.");
		}
		chunks.push(value);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function fetchPublishedPrices(
	claim: ClaimRow,
	fetchModels: CarrierModelsFetch,
): Promise<Map<string, PublishedPrices> | null> {
	const key = claim.providerKeyId
		? await db.query.providerKey.findFirst({
				where: {
					id: { eq: claim.providerKeyId },
					provider: { eq: claim.providerId },
					managed: { eq: true },
					organizationId: { isNull: true },
					status: { eq: "active" },
				},
			})
		: undefined;
	const baseUrl = claim.customBaseUrl ?? key?.baseUrl;
	if (!baseUrl) {
		return null;
	}
	const response = await fetchModels(
		`${baseUrl.replace(/\/+$/, "")}/v1/models`,
		{
			method: "GET",
			headers: {
				Accept: "application/json",
				...(key ? { Authorization: `Bearer ${readProviderKey(key)}` } : {}),
			},
			signal: AbortSignal.any([
				getStopSignal(),
				AbortSignal.timeout(FETCH_TIMEOUT_MS),
			]),
		},
	);
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`The models list responded ${response.status}.`);
	}
	return parsePublishedPrices(await readCappedJson(response));
}

/** Files and applies one published price change. Returns whether it applied. */
async function applyPublishedPrices(
	claim: ClaimRow,
	modelId: string,
	published: PublishedPrices,
): Promise<boolean> {
	// cdb: the gateway bills from cached mapping rows.
	return await cdb.transaction(async (tx) => {
		// Same lock order as approvals: claim, then listing.
		const [lockedClaim] = await tx
			.select({
				status: tables.providerClaim.status,
				autoApproveFares: tables.providerClaim.autoApproveFares,
			})
			.from(tables.providerClaim)
			.where(eq(tables.providerClaim.id, claim.id))
			.for("update")
			.$withCache(false);
		if (lockedClaim?.status !== "active" || !lockedClaim.autoApproveFares) {
			return false;
		}
		const [model] = await tx
			.select()
			.from(tables.providerDraftModel)
			.where(eq(tables.providerDraftModel.id, modelId))
			.for("update")
			.$withCache(false);
		if (!model || model.status !== "active" || model.decisions) {
			return false;
		}
		const filings = await tx
			.select()
			.from(tables.providerPriceFiling)
			.where(eq(tables.providerPriceFiling.draftModelId, modelId))
			.orderBy(
				desc(tables.providerPriceFiling.createdAt),
				desc(tables.providerPriceFiling.id),
			)
			.$withCache(false);
		// A filing awaiting review holds the listing; one per model at a time.
		if (filings.some((filing) => filing.status === "pending")) {
			return false;
		}
		const current = filings.find((filing) => filing.status === "approved");
		if (!current) {
			return false;
		}
		const next = nextPrices(current, published);
		if (!next) {
			return false;
		}
		const [filing] = await tx
			.insert(tables.providerPriceFiling)
			.values({
				draftModelId: model.id,
				providerCompanyId: model.providerCompanyId,
				kind: "update",
				...next,
				// An approved filing's regional set replaces the listing's.
				regionPrices: current.regionPrices,
				note: MODELS_ENDPOINT_FILING_NOTE,
				...autoApprovedFilingFields(),
			})
			.returning();
		await updateAirsideMappingPrices(model, filing, tx);
		return true;
	});
}

async function activeListings(claim: ClaimRow): Promise<DraftModelRow[]> {
	return await db
		.select()
		.from(tables.providerDraftModel)
		.where(
			and(
				eq(
					tables.providerDraftModel.providerCompanyId,
					claim.providerCompanyId,
				),
				eq(tables.providerDraftModel.providerId, claim.providerId),
				eq(tables.providerDraftModel.status, "active"),
				eq(tables.providerDraftModel.decisions, false),
			),
		);
}

/**
 * For every carrier approved for automatic fare changes, reads the prices it
 * publishes on its own /v1/models and applies the ones that differ from the
 * listing's live price as auto-approved update filings, so each change lands
 * in the filing history. Returns the number of filings created.
 */
export async function syncAirsideCarrierPrices(
	fetchModels: CarrierModelsFetch = defaultFetch,
): Promise<number> {
	const claims = await db
		.select()
		.from(tables.providerClaim)
		.where(
			and(
				eq(tables.providerClaim.status, "active"),
				eq(tables.providerClaim.autoApproveFares, true),
			),
		);
	let applied = 0;
	for (const claim of claims) {
		if (getStopSignal().aborted) {
			break;
		}
		try {
			const listings = await activeListings(claim);
			if (listings.length === 0) {
				continue;
			}
			const published = await fetchPublishedPrices(claim, fetchModels);
			if (!published) {
				continue;
			}
			for (const listing of listings) {
				const prices = published.get(listing.externalId);
				if (prices && (await applyPublishedPrices(claim, listing.id, prices))) {
					applied++;
					logger.info("Applied a carrier-published price change", {
						providerId: claim.providerId,
						modelName: listing.modelName,
					});
				}
			}
		} catch (error) {
			// One carrier's endpoint must not stall the rest.
			logger.warn("Airside price sync failed for a carrier", {
				providerId: claim.providerId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return applied;
}
