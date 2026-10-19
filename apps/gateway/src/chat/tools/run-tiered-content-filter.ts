import { trackPendingWork } from "@/lib/pending-work.js";

import { logger, toError } from "@llmgateway/logger";

import { evaluateContentFilterWithClassifiers } from "./content-filter-classifier.js";

import type { GatewayContentFilterResponse } from "@llmgateway/db";

export type TieredContentFilterOutcome = Awaited<
	ReturnType<typeof evaluateContentFilterWithClassifiers>
>;

export interface StartedTieredContentFilter {
	/** Settled outcome; only set when the plan enforces (awaited inline). */
	outcome: TieredContentFilterOutcome;
	/** Background evaluation of a log-only plan, tracked for graceful shutdown. */
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
	},
): Promise<StartedTieredContentFilter> {
	const { plan, context } = options;
	const run = async (signal: AbortSignal | undefined) => {
		const outcome = await evaluateContentFilterWithClassifiers({
			...options,
			signal,
		});
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

	if (plan.enforce) {
		return { outcome: await run(options.signal), pending: null };
	}
	return {
		outcome: null,
		pending: trackPendingWork(
			run(undefined).catch((error: unknown) => {
				logger.warn("Background gateway content filter failed", {
					requestId: context.requestId,
					error: toError(error),
				});
				return null;
			}),
		),
	};
}

/** Raw moderation responses to store on the log, or null when there are none. */
export function getContentFilterLogResponse(
	results: NonNullable<TieredContentFilterOutcome>["results"],
): GatewayContentFilterResponse | null {
	return results.some((result) => result.responses.length > 0)
		? results.flatMap((result) => result.responses)
		: null;
}
