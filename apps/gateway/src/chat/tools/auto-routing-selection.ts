import {
	assignAutoRoutingBands,
	selectAutoRoutingCandidate,
	type AutoRoutingClassification,
	type AutoRoutingClassifier,
	type AutoRoutingDifficulty,
} from "@llmgateway/shared/auto-routing";

import { hasContentFilterCredential } from "./content-filter-credential.js";
import {
	classifyAutoRoutingRequest,
	JEV_AUTO_ROUTING_RUBRIC_VERSION,
} from "./jev-auto-routing-classifier.js";

import type { GatewayContentFilterContext } from "./openai-content-filter.js";
import type { AutoRoutingSessionStore } from "@/lib/auto-routing-session.js";
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
	/**
	 * Present only for a sticky session. The first classified request stores its
	 * verdict here and the rest of the session reuses it.
	 */
	sessionStore?: AutoRoutingSessionStore;
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
 *
 * A sticky session classifies once: later turns reuse the stored verdict and
 * the model it resolved to, so a conversation neither pays for a classifier
 * call per turn nor migrates between models mid-thread (which would cost it the
 * upstream prompt cache). The pinned model still has to be a live candidate —
 * if it dropped out, the stored verdict is re-applied to the current band
 * split rather than triggering a fresh classification.
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

	// Only the classifier path uses the session pin. With no classifier the pick
	// is a deterministic function of the current candidates, so pinning it would
	// only keep a stale choice alive.
	const sessionStore = classifier === "jev" ? params.sessionStore : undefined;
	const saved = sessionStore ? await sessionStore.get() : null;

	let classification: AutoRoutingClassification | null =
		saved?.classification ?? null;
	// A single candidate has nothing to choose between, so skip the round trip.
	let classifierAttempted = false;
	if (
		!saved &&
		classifier === "jev" &&
		sorted.length > 1 &&
		params.classifierAllowed
	) {
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

	let candidate: T | undefined;
	let band: AutoRoutingDifficulty | undefined;
	const pinnedIndex = saved
		? sorted.findIndex((entry) => entry.modelId === saved.selectedModel)
		: -1;
	if (pinnedIndex >= 0) {
		candidate = sorted[pinnedIndex];
		band = bands[pinnedIndex];
	} else {
		const selection = selectAutoRoutingCandidate(sorted, classification);
		if (!selection) {
			return null;
		}
		candidate = selection.candidate;
		band = selection.band ?? undefined;
	}

	if (sessionStore && classification) {
		// Re-persist on every hit so the pin's TTL keeps refreshing while the
		// session stays active, matching sticky provider selection.
		await sessionStore.set({
			classification,
			selectedModel: candidate.modelId,
		});
	}

	return {
		candidate,
		classification,
		decision: {
			classifier,
			...(classifier === "jev"
				? { rubricVersion: JEV_AUTO_ROUTING_RUBRIC_VERSION }
				: {}),
			eligibleModels: configuredModels,
			candidateModels: sorted.map((entry) => entry.modelId),
			difficulty: classification?.difficulty,
			difficultyScore: classification?.difficultyScore,
			task: classification?.task,
			outputType: classification?.outputType,
			bestModel: classification?.bestModel,
			bestModelConfidence: classification?.bestModelConfidence,
			band,
			selectedModel: candidate.modelId,
			// Absent on a reused verdict: no call was made on this request.
			classifierLatencyMs: saved ? undefined : classification?.latencyMs,
			classifierFailed: classifierAttempted && classification === null,
			...(saved ? { classifierReused: true } : {}),
		},
	};
}
