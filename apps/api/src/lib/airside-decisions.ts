import { Decimal } from "decimal.js";
import { HTTPException } from "hono/http-exception";

import { db } from "@llmgateway/db";
import { models as catalogueModels } from "@llmgateway/models";

import type { ModelDefinition } from "@llmgateway/models";

/**
 * Airside decision listings serve typed decisions on the carrier's own
 * OpenAI-compatible `POST /v1/decisions` instead of chat completions. Only
 * image input and the input window describe them; these chat fields are
 * pinned on every decision listing.
 */
export const DECISION_LISTING_CHAT_FIELDS = {
	streaming: false,
	audio: false,
	tools: false,
	supportedToolChoices: null,
	jsonOutput: false,
	jsonOutputSchema: false,
	reasoning: false,
	reasoningMaxTokens: false,
	reasoningEfforts: null,
	webSearch: false,
	webSearchFormat: null,
	maxOutput: null,
} as const;

function catalogueModelFor(modelName: string): ModelDefinition | undefined {
	return (catalogueModels as readonly ModelDefinition[]).find(
		(model) => model.id === modelName || model.aliases?.includes(modelName),
	);
}

function kindLabel(decisions: boolean): string {
	return decisions ? "a decision model" : "a chat model";
}

/**
 * A model id serves one endpoint: every listing under it, and the catalogue
 * entry of the same id, must agree on whether it is a decision model.
 */
export async function assertListingKind(
	modelName: string,
	decisions: boolean,
): Promise<void> {
	const catalogueModel = catalogueModelFor(modelName);
	if (catalogueModel) {
		const catalogueDecisions =
			catalogueModel.output?.includes("decision") ?? false;
		if (catalogueDecisions !== decisions) {
			throw new HTTPException(409, {
				message: `${modelName} is ${kindLabel(catalogueDecisions)} in the LLM Gateway catalogue and cannot be listed as ${kindLabel(decisions)}.`,
			});
		}
	}
	// Only listings in service fix a model's kind; drafts are checked again
	// when their initial filing is approved.
	const conflicting = await db.query.providerDraftModel.findFirst({
		where: {
			modelName: { eq: modelName },
			status: { eq: "active" },
			decisions: { eq: !decisions },
		},
		columns: { id: true },
	});
	if (conflicting) {
		throw new HTTPException(409, {
			message: `${modelName} is already listed as ${kindLabel(!decisions)} and cannot be listed as ${kindLabel(decisions)}.`,
		});
	}
}

interface DecisionPricing {
	outputPrice: string;
	cachedInputPrice?: string | null;
	regionPrices?: unknown[] | null;
}

/**
 * Decisions bill input tokens (plus an optional per-request price) only, at
 * one flat rate: the gateway never charges output, cached or regional rates
 * on `/v1/decisions`, so a decision listing cannot file them.
 */
export function assertDecisionPricing(
	decisions: boolean,
	pricing: DecisionPricing,
): void {
	if (!decisions) {
		return;
	}
	if (!new Decimal(pricing.outputPrice).isZero()) {
		throw new HTTPException(400, {
			message:
				"Decision models are billed on input tokens only — file an output price of 0.",
		});
	}
	if (pricing.cachedInputPrice) {
		throw new HTTPException(400, {
			message: "Decision models take no cached input price.",
		});
	}
	if (pricing.regionPrices?.length) {
		throw new HTTPException(400, {
			message: "Decision models take one fare; regional fares do not apply.",
		});
	}
}

/** A decision listing's edits cannot claim chat capabilities. */
export function assertDecisionMetadataEdit(
	decisions: boolean,
	changes: object,
): void {
	if (!decisions) {
		return;
	}
	const updates = changes as Record<string, unknown>;
	const claimed = Object.entries(DECISION_LISTING_CHAT_FIELDS)
		.filter(
			([key, pinned]) =>
				key in updates &&
				updates[key] !== undefined &&
				updates[key] !== pinned &&
				!(Array.isArray(updates[key]) && updates[key].length === 0),
		)
		.map(([key]) => key);
	if (claimed.length > 0) {
		throw new HTTPException(400, {
			message: `Decision models declare only image input and context size; remove ${claimed.join(", ")}.`,
		});
	}
}
