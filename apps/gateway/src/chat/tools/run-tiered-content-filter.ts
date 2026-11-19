import { trackPendingWork } from "@/lib/pending-work.js";

import { logger, toError } from "@llmgateway/logger";

import {
	evaluateContentFilterWithClassifiers,
	isDecidingClassifierAvailable,
	runShadowContentFilters,
	withShadowVerdicts,
} from "./content-filter-classifier.js";
import { preserveFlaggedContentFilterPayload } from "./flagged-payload.js";

import type { FlaggedPayloadOrigin } from "./flagged-payload.js";
import type { GatewayContentFilterResponse } from "@llmgateway/db";

export type TieredContentFilterOutcome = Awaited<
	ReturnType<typeof evaluateContentFilterWithClassifiers>
>;

export interface StartedTieredContentFilter {
	/** Deciding verdict; only set when the plan enforces (awaited inline). */
	outcome: TieredContentFilterOutcome;
	/**
	 * Full outcome, shadow verdicts included, when anything still runs in the
	 * background: a log-only plan, or shadows behind an enforcing one. Tracked
	 * for graceful shutdown; log it instead of `outcome` when set.
	 */
	pending: Promise<TieredContentFilterOutcome> | null;
}

/**
 * Run the tiered gateway content filter for a resolved plan. Only a verdict
 * that can block is awaited; otherwise the classifier runs in the background,
 * detached from the client's signal so a hang-up does not cancel the
 * observation (each classifier's own timeout bounds it).
 */
export async function startTieredContentFilter(
	options: Parameters<typeof evaluateContentFilterWithClassifiers>[0] & {
		signal: AbortSignal;
		/** Recorded when a flagged payload is preserved. */
		origin: FlaggedPayloadOrigin;
	},
): Promise<StartedTieredContentFilter> {
	const { plan, context } = options;
	const run = async (signal: AbortSignal | undefined) => {
		const outcome = await evaluateContentFilterWithClassifiers({
			...options,
			signal,
		});
		if (outcome) {
			// Detached: never delays or fails the request.
			preserveFlaggedContentFilterPayload({
				plan,
				evaluation: outcome.evaluation,
				messages: options.messages,
				context,
				origin: options.origin,
			});
		}
		if (outcome?.evaluation.violation) {
			logger.debug("gateway_content_filter_tier", {
				requestId: context.requestId,
				organizationId: context.organizationId,
				provider: plan.provider,
				tier: plan.tier,
				level: plan.level,
				classifier: plan.classifier,
				action: outcome.evaluation.action,
				matchedCategories: outcome.evaluation.matchedCategories,
			});
		}
		return outcome;
	};
	// Shadows start alongside the deciding classifier but are never awaited
	// before the provider call; the log row waits for them instead. They are
	// skipped when the deciding classifier cannot run: there would be no
	// evaluation to record them on.
	const shadows =
		plan.shadowClassifiers.length > 0
			? trackPendingWork(
					isDecidingClassifierAvailable(options)
						.then(async (available) =>
							available ? await runShadowContentFilters(options) : [],
						)
						.catch((error: unknown) => {
							logger.warn("Shadow content filters failed", {
								requestId: context.requestId,
								error: toError(error),
							});
							return [];
						}),
				)
			: null;
	const attachShadows = async (
		outcome: TieredContentFilterOutcome,
	): Promise<TieredContentFilterOutcome> =>
		outcome && shadows
			? withShadowVerdicts(plan, outcome, await shadows)
			: outcome;
	// A failure falls back to the deciding verdict when there is one.
	const track = (
		outcome: Promise<TieredContentFilterOutcome>,
		fallback: TieredContentFilterOutcome = null,
	) =>
		trackPendingWork(
			outcome.then(attachShadows).catch((error: unknown) => {
				logger.warn("Background gateway content filter failed", {
					requestId: context.requestId,
					error: toError(error),
				});
				return fallback;
			}),
		);

	if (plan.enforce) {
		const outcome = await run(options.signal);
		return {
			outcome,
			pending:
				outcome && shadows ? track(Promise.resolve(outcome), outcome) : null,
		};
	}
	return { outcome: null, pending: track(run(undefined)) };
}

/** Raw moderation responses to store on the log, or null when there are none. */
export function getContentFilterLogResponse(
	results: NonNullable<TieredContentFilterOutcome>["results"],
): GatewayContentFilterResponse | null {
	return results.some((result) => result.responses.length > 0)
		? results.flatMap((result) => result.responses)
		: null;
}
