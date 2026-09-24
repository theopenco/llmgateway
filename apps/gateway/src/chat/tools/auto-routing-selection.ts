import {
	assignAutoRoutingBands,
	selectAutoRoutingCandidate,
	type AutoRoutingClassification,
	type AutoRoutingClassifier,
} from "@llmgateway/shared/auto-routing";

import { hasContentFilterCredential } from "./content-filter-credential.js";
import {
	classifyAutoRoutingRequest,
	JEV_AUTO_ROUTING_RUBRIC_VERSION,
} from "./jev-auto-routing-classifier.js";

import type { GatewayContentFilterContext } from "./openai-content-filter.js";
import type { RoutingMetadata } from "@llmgateway/actions";
import type { BaseMessage, ModelDefinition } from "@llmgateway/models";

interface AutoRoutingModelCandidate {
	modelId: string;
	modelDef: ModelDefinition;
	price: number;
}

export interface AutoRoutingSelectionParams<
	T extends AutoRoutingModelCandidate,
> {
	candidates: T[];
	/** The organization's configured list, or null for the built-in candidate set. */
	configuredModels: string[] | null;
	classifier: AutoRoutingClassifier;
	/** False when the org's compliance policy disallows the classifier's provider. */
	classifierAllowed: boolean;
	messages: BaseMessage[];
	toolNames: string[];
	hasImages: boolean;
	estimatedInputTokens: number;
	context: GatewayContentFilterContext;
	requestSignal?: AbortSignal;
}

export interface AutoRoutingSelectionResult<
	T extends AutoRoutingModelCandidate,
> {
	candidate: T;
	classification: AutoRoutingClassification | null;
	/** Only produced for a configured list; the built-in set logs nothing new. */
	decision?: RoutingMetadata["autoRouting"];
}

/**
 * Pick which of the surviving auto-routing candidates serves the request.
 *
 * Without a configured list this is the historical behaviour — the cheapest
 * candidate — and nothing is logged. With one, an enabled classifier rates the
 * request and the pick comes from the matching price band; a classifier that
 * cannot run (no credential, single candidate, upstream failure) degrades to
 * the cheapest candidate and is recorded as `classifierFailed`.
 */
export async function selectAutoRoutingModel<
	T extends AutoRoutingModelCandidate,
>(
	params: AutoRoutingSelectionParams<T>,
): Promise<AutoRoutingSelectionResult<T> | null> {
	const { candidates, configuredModels, classifier } = params;
	if (candidates.length === 0) {
		return null;
	}

	if (!configuredModels) {
		const selection = selectAutoRoutingCandidate(candidates, null);
		return selection
			? { candidate: selection.candidate, classification: null }
			: null;
	}

	const sorted = [...candidates].sort((a, b) => a.price - b.price);
	const bands = assignAutoRoutingBands(sorted.length);

	let classification: AutoRoutingClassification | null = null;
	// A single candidate has nothing to choose between, so skip the round trip.
	let classifierAttempted = false;
	if (classifier === "jev" && sorted.length > 1 && params.classifierAllowed) {
		classifierAttempted = await hasContentFilterCredential("typesafe");
		if (classifierAttempted) {
			classification = await classifyAutoRoutingRequest(
				{
					messages: params.messages,
					toolNames: params.toolNames,
					hasImages: params.hasImages,
					estimatedInputTokens: params.estimatedInputTokens,
					candidates: sorted.map((candidate, index) => ({
						id: candidate.modelId,
						name: candidate.modelDef.name ?? candidate.modelId,
						description: candidate.modelDef.description,
						band: bands[index],
					})),
				},
				params.context,
				params.requestSignal,
			);
		}
	}

	const selection = selectAutoRoutingCandidate(sorted, classification);
	if (!selection) {
		return null;
	}

	return {
		candidate: selection.candidate,
		classification,
		decision: {
			classifier,
			...(classifier === "jev"
				? { rubricVersion: JEV_AUTO_ROUTING_RUBRIC_VERSION }
				: {}),
			eligibleModels: configuredModels,
			candidateModels: sorted.map((candidate) => candidate.modelId),
			difficulty: classification?.difficulty,
			difficultyScore: classification?.difficultyScore,
			task: classification?.task,
			outputType: classification?.outputType,
			bestModel: classification?.bestModel,
			bestModelConfidence: classification?.bestModelConfidence,
			band: selection.band ?? undefined,
			selectedModel: selection.candidate.modelId,
			classifierLatencyMs: classification?.latencyMs,
			classifierFailed: classifierAttempted && classification === null,
		},
	};
}
