import { getProviderDefinition } from "@llmgateway/models";
import {
	assignSmartRoutingBands,
	selectSmartRoutingCandidate,
	type RequestClassification,
	type SmartRoutingClassifier,
	type SmartRoutingDifficulty,
	type SmartRoutingEffort,
	type SmartRoutingWorkChange,
} from "@llmgateway/shared/smart-routing";
import {
	decideSmartRoutingRecheck,
	decideSmartRoutingSwitch,
	estimateRemainingTurns,
	estimateSmartRoutingEconomics,
	type SmartRoutingEconomics,
	type SmartRoutingRecheckTrigger,
} from "@llmgateway/shared/smart-routing-policy";

import { hasContentFilterCredential } from "./content-filter-credential.js";
import {
	classifyRequest,
	JEV_CLASSIFIER_RUBRIC_VERSION,
	type RequestClassifierRecheck,
} from "./jev-request-classifier.js";
import { isSmartRoutingTurnBoundary } from "./smart-routing-turn.js";

import type { ClassifierRequestContext } from "./log-classifier-usage.js";
import type {
	SmartRoutingSessionActivity,
	SmartRoutingSessionEntry,
	SmartRoutingSessionStore,
} from "@/lib/smart-routing-session.js";
import type {
	RoutingMetadata,
	SmartRoutingSwitch,
	SmartRoutingTrigger,
} from "@llmgateway/actions";
import type {
	BaseMessage,
	ModelDefinition,
	ProviderModelMapping,
} from "@llmgateway/models";

interface SmartRoutingModelCandidate {
	modelId: string;
	modelDef: ModelDefinition;
	price: number;
	/** The mappings that survived filtering; priced for switch economics. */
	providers?: ProviderModelMapping[];
}

export interface SmartRoutingSelectionParams<
	T extends SmartRoutingModelCandidate,
> {
	candidates: T[];
	/** The organization's configured list, or null for the built-in candidate set. */
	configuredModels: string[] | null;
	classifier: SmartRoutingClassifier;
	/** Serves an opening turn the classifier gave no verdict for. */
	fallbackModel?: string;
	/** False when the org's compliance policy disallows the classifier's provider. */
	classifierAllowed: boolean;
	/** The caller set a reasoning effort, which routing never overrides. */
	callerEffort: boolean;
	/**
	 * Present only for a sticky session: the choice is kept across turns and
	 * re-evaluated only at the points `decideSmartRoutingRecheck` allows.
	 */
	sessionStore?: SmartRoutingSessionStore;
	messages: BaseMessage[];
	toolNames: string[];
	hasImages: boolean;
	estimatedInputTokens: number;
	context: ClassifierRequestContext;
	requestSignal?: AbortSignal;
	now?: number;
}

export interface SmartRoutingSelectionResult<
	T extends SmartRoutingModelCandidate,
> {
	candidate: T;
	classification: RequestClassification | null;
	/** Effort tier to apply when the caller set none. */
	effort?: SmartRoutingEffort;
	/** Only produced for a configured list; the built-in set logs nothing new. */
	decision?: RoutingMetadata["smartRouting"];
}

/** The charge belongs to the request that made the call, not to later turns. */
function withoutCost(
	classification: RequestClassification,
): RequestClassification {
	return { ...classification, cost: undefined };
}

/**
 * The mapping a candidate is priced at: the provider the session is already
 * on when it serves the candidate, otherwise its cheapest priced mapping.
 */
function representativeMapping(
	candidate: SmartRoutingModelCandidate,
	preferredProviderId: string | undefined,
): ProviderModelMapping | undefined {
	const mappings = candidate.providers ?? [];
	const preferred = mappings.find(
		(mapping) => mapping.providerId === preferredProviderId,
	);
	if (preferred) {
		return preferred;
	}
	let cheapest: ProviderModelMapping | undefined;
	for (const mapping of mappings) {
		if (mapping.inputPrice === undefined || mapping.outputPrice === undefined) {
			continue;
		}
		const price = Number(mapping.inputPrice) + Number(mapping.outputPrice);
		if (
			!cheapest ||
			price < Number(cheapest.inputPrice) + Number(cheapest.outputPrice)
		) {
			cheapest = mapping;
		}
	}
	return cheapest;
}

function estimateSwitchEconomics(input: {
	saved: SmartRoutingSessionEntry;
	activity: SmartRoutingSessionActivity | null;
	current: SmartRoutingModelCandidate;
	proposed: SmartRoutingModelCandidate;
	currentEffort?: SmartRoutingEffort;
	proposedEffort?: SmartRoutingEffort;
	trigger: SmartRoutingRecheckTrigger;
	checkCostUsd: number;
}): SmartRoutingEconomics | null {
	const { activity } = input;
	if (!activity || activity.requests === 0) {
		return null;
	}
	const sameModel = input.current.modelId === input.proposed.modelId;
	const currentMapping = representativeMapping(
		input.current,
		activity.lastProvider,
	);
	const proposedMapping = representativeMapping(
		input.proposed,
		sameModel ? activity.lastProvider : undefined,
	);
	if (!currentMapping || !proposedMapping) {
		return null;
	}
	// A cache is per provider and model. Only an effort change on the same
	// route can keep it, and only where the provider documents that it does.
	const switchBreaksCache =
		!sameModel ||
		currentMapping.providerId !== proposedMapping.providerId ||
		getProviderDefinition(currentMapping.providerId)
			?.reasoningEffortChangePreservesCache !== true;
	const turns = Math.max(input.saved.turnCount ?? 1, 1);
	return estimateSmartRoutingEconomics({
		current: { prices: currentMapping, effort: input.currentEffort },
		proposed: { prices: proposedMapping, effort: input.proposedEffort },
		workload: {
			promptTokensPerTurn: activity.promptTokens / turns,
			outputTokensPerTurn: activity.outputTokens / turns,
			cacheHitRate:
				activity.promptTokens > 0
					? Math.min(1, activity.cachedTokens / activity.promptTokens)
					: 0,
			contextTokens: activity.lastPromptTokens,
		},
		remainingTurns: estimateRemainingTurns(turns),
		currentCacheWarm: input.trigger !== "cache-expired",
		switchBreaksCache,
		checkCostUsd: input.checkCostUsd,
	});
}

/**
 * A short, user-facing reason for a change of model or effort.
 */
export function describeSmartRoutingSwitch(change: SmartRoutingSwitch): string {
	const target = `${change.toModel}${change.toEffort ? ` (${change.toEffort} effort)` : ""}`;
	switch (change.reason) {
		case "harder-work":
			return `Switched to ${target}: the work became harder.`;
		case "savings":
			return `Switched to ${target}: the remaining work is cheaper there.`;
		case "model-unavailable":
			return `Switched to ${target}: ${change.fromModel} is unavailable for this request.`;
		default:
			return `Switched to ${target}.`;
	}
}

/**
 * Pick which of the surviving smart-routing candidates serves the request, and
 * at which reasoning effort.
 *
 * Without a configured list this is the historical behaviour — the cheapest
 * candidate — and nothing is logged. With one, an enabled classifier rates the
 * request and the pick comes from the matching price band; without a verdict
 * the configured fallback (or the cheapest candidate) serves the request.
 * `classifierFailed` records only an attempted call that produced no verdict.
 *
 * A sticky session keeps its model and effort across turns so the upstream
 * prompt cache stays warm, and reuses them without another classifier call.
 * Only a new user turn may re-evaluate the choice, and only once the
 * provider's cache has provably expired or a periodic work scan is due. A
 * recheck upgrades for harder work, and otherwise moves only when the savings
 * cover the check and the cache rebuild.
 */
export async function selectSmartRoutingModel<
	T extends SmartRoutingModelCandidate,
>(
	params: SmartRoutingSelectionParams<T>,
): Promise<SmartRoutingSelectionResult<T> | null> {
	const { candidates, configuredModels, classifier } = params;
	if (candidates.length === 0) {
		return null;
	}

	if (!configuredModels) {
		const selection = selectSmartRoutingCandidate(candidates, null);
		return selection
			? { candidate: selection.candidate, classification: null }
			: null;
	}

	const now = params.now ?? Date.now();
	const sorted = [...candidates].sort((a, b) => a.price - b.price);
	const bands = assignSmartRoutingBands(sorted.length);
	const bandOf = (candidate: T) => bands[sorted.indexOf(candidate)];

	// Only the classifier path uses the session pin. With no classifier the pick
	// is a deterministic function of the current candidates, so pinning it would
	// only keep a stale choice alive.
	const sessionStore = classifier === "jev" ? params.sessionStore : undefined;
	const [saved, activity] = sessionStore
		? await Promise.all([sessionStore.get(), sessionStore.getActivity()])
		: [null, null];

	// Latency and charge of the call this request made, if any — never another
	// turn's.
	let classifierLatencyMs: number | undefined;
	let classifierCost: number | undefined;
	let classifierAttempted = false;
	let freshVerdict: RequestClassification | null = null;
	const runClassifier = async (recheck?: RequestClassifierRecheck) => {
		// A single candidate has nothing to choose between, so skip the call.
		if (
			classifier !== "jev" ||
			sorted.length < 2 ||
			!params.classifierAllowed
		) {
			return null;
		}
		// The lookup reads the managed-credential table, which throws when both
		// the cache and its SWR mirror are gone. The classifier is fail-open by
		// design, so a credential lookup must not fail the request.
		try {
			classifierAttempted = await hasContentFilterCredential("typesafe");
		} catch {
			classifierAttempted = false;
		}
		if (!classifierAttempted) {
			return null;
		}
		freshVerdict = await classifyRequest(
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
				recheck,
			},
			params.context,
			params.requestSignal,
		);
		classifierLatencyMs = freshVerdict?.latencyMs;
		classifierCost = freshVerdict?.cost;
		return freshVerdict;
	};
	const effortOf = (verdict: RequestClassification | null | undefined) =>
		params.callerEffort ? undefined : verdict?.effort;

	let candidate: T;
	let band: SmartRoutingDifficulty | undefined;
	let classification: RequestClassification | null;
	let effort: SmartRoutingEffort | undefined;
	// True whenever the verdict being served was produced by another request of
	// the same session rather than by this one.
	let verdictReused = false;
	let trigger: SmartRoutingTrigger | undefined;
	let workChange: SmartRoutingWorkChange | undefined;
	let keptReason: string | undefined;
	let change: SmartRoutingSwitch | undefined;

	const adopt = (entry: SmartRoutingSessionEntry) => {
		const index = sorted.findIndex(
			(other) => other.modelId === entry.selectedModel,
		);
		if (index < 0) {
			return false;
		}
		candidate = sorted[index];
		band = bands[index];
		classification = entry.classification;
		effort = params.callerEffort ? undefined : entry.effort;
		verdictReused = true;
		return true;
	};

	if (!saved) {
		classification = await runClassifier();
		const fallbackIndex =
			!classification && classifier === "jev" && params.fallbackModel
				? sorted.findIndex((entry) => entry.modelId === params.fallbackModel)
				: -1;
		if (fallbackIndex >= 0) {
			candidate = sorted[fallbackIndex];
			band = bands[fallbackIndex];
		} else {
			const selection = selectSmartRoutingCandidate(sorted, classification);
			if (!selection) {
				return null;
			}
			candidate = selection.candidate;
			band = selection.band ?? undefined;
		}
		effort = effortOf(classification);
		if (sessionStore) {
			trigger = "initial";
		}

		// Without a verdict nothing is stored, so the next turn classifies again.
		if (sessionStore && classification) {
			// Opening turn: claim the session atomically. When a concurrent first
			// turn got there first, adopt its choice so both turns agree instead of
			// the later write silently re-pinning.
			const entry: SmartRoutingSessionEntry = {
				version: 1,
				classification: withoutCost(classification),
				selectedModel: candidate.modelId,
				effort,
				turnCount: 1,
				turnsSinceCheck: 0,
				turnsSinceSwitch: 0,
				lastCheckAt: now,
			};
			const claimed = await sessionStore.claim(entry);
			if (claimed !== entry) {
				adopt(claimed);
			}
		}
	} else {
		verdictReused = true;
		classification = saved.classification;
		effort = params.callerEffort ? undefined : saved.effort;
		const pinnedIndex = sorted.findIndex(
			(entry) => entry.modelId === saved.selectedModel,
		);
		if (pinnedIndex >= 0) {
			candidate = sorted[pinnedIndex];
			band = bands[pinnedIndex];
		} else {
			// The pinned model dropped out (health, compliance, or a capability
			// this request needs): re-apply the stored verdict to the current
			// band split rather than paying for a fresh classification.
			const selection = selectSmartRoutingCandidate(
				sorted,
				saved.classification,
			);
			if (!selection) {
				return null;
			}
			candidate = selection.candidate;
			band = selection.band ?? undefined;
			change = {
				fromModel: saved.selectedModel,
				toModel: candidate.modelId,
				fromEffort: saved.effort,
				toEffort: effort,
				reason: "model-unavailable",
			};
		}

		const turnBoundary = isSmartRoutingTurnBoundary(
			params.messages,
			activity?.lastFinishReason,
		);
		if (!turnBoundary) {
			trigger = "mid-turn";
			await sessionStore!.touch();
		} else {
			const expectedVersion = saved.version ?? 0;
			const turnsSinceSwitch = (saved.turnsSinceSwitch ?? 0) + 1;
			const lastProvider = activity
				? getProviderDefinition(activity.lastProvider)
				: undefined;
			const recheck = decideSmartRoutingRecheck({
				turnBoundary,
				turnsSinceCheck: (saved.turnsSinceCheck ?? 0) + 1,
				idleSeconds: activity
					? (now - activity.lastActivityAt) / 1000
					: undefined,
				cacheMaxIdleSeconds: activity?.usedExtendedCache
					? lastProvider?.promptCacheExtendedMaxIdleSeconds
					: lastProvider?.promptCacheMaxIdleSeconds,
			});
			trigger = recheck ?? "reused";

			let next: SmartRoutingSessionEntry = {
				...saved,
				selectedModel: candidate.modelId,
				turnCount: (saved.turnCount ?? 1) + 1,
				turnsSinceCheck: (saved.turnsSinceCheck ?? 0) + 1,
				turnsSinceSwitch,
			};

			if (recheck) {
				const current = candidate;
				const currentBand = band ?? bandOf(current);
				const currentEffort = effort;
				const verdict = await runClassifier({
					previous: saved.classification,
					currentModel: current.modelId,
					currentEffort,
				});
				// A failed or unsure check keeps the current choice; the next
				// check waits for the next trigger rather than retrying each turn.
				next = { ...next, turnsSinceCheck: 0, lastCheckAt: now };
				if (verdict) {
					workChange = verdict.workChange;
					const proposal = selectSmartRoutingCandidate(sorted, verdict)!;
					const proposedEffort = effortOf(verdict);
					const proposedBand = proposal.band ?? bandOf(proposal.candidate);
					const economics = estimateSwitchEconomics({
						saved,
						activity,
						current,
						proposed: proposal.candidate,
						currentEffort,
						proposedEffort,
						trigger: recheck,
						checkCostUsd: verdict.cost ?? 0,
					});
					const decision = decideSmartRoutingSwitch({
						current: {
							modelId: current.modelId,
							band: currentBand,
							effort: currentEffort,
						},
						proposed: {
							modelId: proposal.candidate.modelId,
							band: proposedBand,
							effort: proposedEffort,
						},
						classification: verdict,
						turnsSinceSwitch,
						economics,
					});
					if (decision.apply) {
						change = {
							fromModel: saved.selectedModel,
							toModel: proposal.candidate.modelId,
							fromEffort: saved.effort,
							toEffort: proposedEffort,
							direction: decision.direction,
							reason: decision.reason,
							estimatedStayUsd: economics?.stayUsd,
							estimatedSwitchUsd: economics?.switchUsd,
						};
						candidate = proposal.candidate;
						band = proposedBand;
						effort = proposedEffort;
						classification = verdict;
						verdictReused = false;
						next = {
							...next,
							classification: withoutCost(verdict),
							selectedModel: candidate.modelId,
							effort,
							turnsSinceSwitch: 0,
							lastSwitchAt: now,
						};
					} else {
						keptReason = decision.reason;
					}
				}
			}

			const stored = await sessionStore!.replace(expectedVersion, next);
			if (
				stored.version !== expectedVersion + 1 ||
				stored.selectedModel !== next.selectedModel ||
				stored.effort !== next.effort
			) {
				// Another turn of this session decided first; its choice stands and
				// this request's decision is discarded as stale.
				if (adopt(stored)) {
					change = undefined;
				}
			}
		}
	}

	return {
		candidate,
		classification,
		effort,
		decision: {
			classifier,
			...(classifier === "jev"
				? { rubricVersion: JEV_CLASSIFIER_RUBRIC_VERSION }
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
			classifierLatencyMs,
			classifierCost,
			classifierFailed: classifierAttempted && freshVerdict === null,
			...(verdictReused ? { classifierReused: true } : {}),
			...(trigger ? { trigger } : {}),
			...(effort
				? { effort, effortSource: "classifier" as const }
				: params.callerEffort
					? { effortSource: "caller" as const }
					: {}),
			...(workChange ? { workChange } : {}),
			...(keptReason ? { keptReason } : {}),
			...(change ? { switch: change } : {}),
		},
	};
}
