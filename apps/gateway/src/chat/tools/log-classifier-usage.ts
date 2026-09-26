import { Decimal } from "decimal.js";

import { calculateDataStorageCost, insertLog } from "@/lib/logs.js";
import { trackPendingWork } from "@/lib/pending-work.js";

import { logger, toError } from "@llmgateway/logger";
import { models, type ProviderModelMapping } from "@llmgateway/models";

import { createLogEntry } from "./create-log-entry.js";

import type { GatewayApiKey } from "@/lib/cached-queries.js";
import type { ApiOrigin, Project } from "@llmgateway/db";

const CLASSIFIER_PROVIDER = "typesafe";

/**
 * Everything the classifier needs to bill its own call back to the request it
 * was run for. The classifier always runs on a platform credential, so no
 * organization provider key is passed and the row is billed as credits even
 * for a BYOK project — the organization did not pay TypeSafe, we did.
 */
export interface ClassifierRequestContext {
	requestId: string;
	project: Project;
	apiKey: GatewayApiKey;
	retentionLevel: "retain" | "none";
	/** The model string the caller asked for, e.g. "smart" or "dynamic/<name>". */
	requestedModel: string;
	source?: string;
	userAgent?: string;
	apiOrigin?: ApiOrigin;
}

export interface ClassifierUsage {
	inputTokens: number | null;
	outputTokens: number | null;
}

export interface ClassifierCost {
	inputCost: number;
	requestCost: number;
	totalCost: number;
}

/**
 * Price one classification off the catalogue entry for the classifier model.
 * Decision models are billed on input tokens only — output is priced at zero —
 * which is the same rule the public `/v1/systemone` endpoint applies.
 */
export function calculateClassifierCost(
	modelId: string,
	usage: ClassifierUsage,
): ClassifierCost {
	const mapping: ProviderModelMapping | undefined = models
		.find((definition) => definition.id === modelId)
		?.providers.find((provider) => provider.providerId === CLASSIFIER_PROVIDER);
	if (!mapping) {
		return { inputCost: 0, requestCost: 0, totalCost: 0 };
	}

	const inputCost = new Decimal(mapping.inputPrice ?? "0").times(
		usage.inputTokens ?? 0,
	);
	const requestCost = new Decimal(mapping.requestPrice ?? "0");
	return {
		inputCost: inputCost.toNumber(),
		requestCost: requestCost.toNumber(),
		totalCost: inputCost.plus(requestCost).toNumber(),
	};
}

interface LogClassifierUsageParams {
	context: ClassifierRequestContext;
	modelId: string;
	externalId: string;
	/** The state handed to the classifier, stored as the row's request payload. */
	prompt: string;
	usage: ClassifierUsage;
	answers: unknown;
	responseSize: number;
	durationMs: number;
}

/**
 * Record one classifier call as its own billed log row, attributed to the
 * organization, project and API key of the request that triggered it.
 *
 * Returns the amount charged, for the routing metadata. Writing the row is not
 * awaited: this sits ahead of the first upstream token, so it goes through the
 * pending-work registry instead — which keeps a rollout from closing the pool
 * underneath it.
 */
export function logClassifierUsage(params: LogClassifierUsageParams): number {
	const { context, usage } = params;
	const costs = calculateClassifierCost(params.modelId, usage);

	void trackPendingWork(
		insertLog(
			{
				...createLogEntry({
					requestId: context.requestId,
					project: context.project,
					apiKey: context.apiKey,
					usedModel: `${CLASSIFIER_PROVIDER}/${params.modelId}`,
					usedModelMapping: params.externalId,
					usedProvider: CLASSIFIER_PROVIDER,
					requestedModel: context.requestedModel,
					requestedProvider: CLASSIFIER_PROVIDER,
					messages: [{ role: "user", content: params.prompt }],
					source: context.source,
					apiOrigin: context.apiOrigin ?? "systemone",
					customHeaders: {},
					debugMode: false,
					userAgent: context.userAgent,
				}),
				duration: params.durationMs,
				timeToFirstToken: null,
				timeToFirstReasoningToken: null,
				responseSize: params.responseSize,
				content: JSON.stringify(params.answers ?? null).slice(0, 1000),
				reasoningContent: null,
				finishReason: "stop",
				promptTokens:
					usage.inputTokens !== null ? usage.inputTokens.toString() : null,
				completionTokens:
					usage.outputTokens !== null ? usage.outputTokens.toString() : null,
				totalTokens:
					usage.inputTokens !== null
						? (usage.inputTokens + (usage.outputTokens ?? 0)).toString()
						: null,
				reasoningTokens: null,
				cachedTokens: null,
				cacheWriteTokens: null,
				hasError: false,
				streamed: false,
				canceled: false,
				errorDetails: null,
				inputCost: costs.inputCost,
				outputCost: 0,
				cachedInputCost: 0,
				cacheWriteInputCost: 0,
				requestCost: costs.requestCost,
				webSearchCost: 0,
				contentFilterCost: null,
				imageInputTokens: null,
				imageOutputTokens: null,
				imageInputCost: null,
				imageOutputCost: null,
				audioInputTokens: null,
				audioInputCost: null,
				cost: costs.totalCost,
				// Only true when the classifier answered without reporting usage,
				// which would make the charge a guess rather than a measurement.
				estimatedCost: usage.inputTokens === null,
				discount: null,
				pricingTier: null,
				requestedServiceTier: null,
				usedServiceTier: null,
				dataStorageCost: calculateDataStorageCost(
					usage.inputTokens,
					null,
					usage.outputTokens,
					null,
					context.retentionLevel,
				),
				cached: false,
				tools: null,
				toolResults: null,
				toolChoice: null,
			},
			{ retentionLevel: context.retentionLevel },
		).catch((error) => {
			logger.warn("Failed to persist request classifier usage", {
				requestId: context.requestId,
				organizationId: context.project.organizationId,
				model: params.modelId,
				err: toError(error),
			});
		}),
	);

	return costs.totalCost;
}
