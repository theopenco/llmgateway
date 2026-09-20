import { logger } from "@llmgateway/logger";

import {
	checkJevContentFilter,
	hasJevContentFilterCredential,
} from "./jev-content-filter.js";
import {
	buildOpenAIContentFilterImageInputs,
	checkOpenAIContentFilter,
	hasOpenAIContentFilterCredential,
	type GatewayContentFilterContext,
	type OpenAIContentFilterCheckResult,
} from "./openai-content-filter.js";
import {
	buildGatewayContentFilterEvaluation,
	evaluateTieredContentFilter,
	type TieredContentFilterPlan,
} from "./tiered-content-filter.js";

import type { GatewayContentFilterEvaluation } from "@llmgateway/db";
import type { BaseMessage, ProviderId } from "@llmgateway/models";
import type { ContentFilterClassifier } from "@llmgateway/shared";

/** The catalogue provider each classifier calls, for compliance gating. */
export const CONTENT_FILTER_CLASSIFIER_PROVIDERS: Record<
	ContentFilterClassifier,
	ProviderId
> = {
	openai: "openai",
	jev: "typesafe",
};

export interface ContentFilterCheckResult extends OpenAIContentFilterCheckResult {
	classifier: ContentFilterClassifier;
	/**
	 * A delegated image moderation call was attempted and came back empty. The
	 * text verdict still stands, so this never adds a violation — it is what
	 * stops the evaluation from recording a fully successful moderation when
	 * the request's images went uncovered.
	 */
	imageModerationFailed?: boolean;
}

/** Whether a check covered everything it set out to cover. */
function moderationFailed(result: ContentFilterCheckResult): boolean {
	return result.results.length === 0 || result.imageModerationFailed === true;
}

export async function hasClassifierCredential(
	classifier: ContentFilterClassifier,
): Promise<boolean> {
	return classifier === "jev"
		? await hasJevContentFilterCredential()
		: await hasOpenAIContentFilterCredential();
}

/**
 * Run one classifier over a request's content.
 *
 * Jev is text-only, so image parts are moderated through OpenAI and merged in —
 * but only when `imagesAllowed` says the organization's compliance policy
 * permits OpenAI and a credential exists. Without that, a Jev-classified
 * request carries no image coverage at all rather than silently sending image
 * data to a provider the policy excluded.
 */
export async function runContentFilterClassifier(
	classifier: ContentFilterClassifier,
	messages: BaseMessage[],
	context: GatewayContentFilterContext,
	requestSignal: AbortSignal | undefined,
	options: { imagesAllowed: boolean },
): Promise<ContentFilterCheckResult> {
	if (classifier === "openai") {
		const result = await checkOpenAIContentFilter(
			messages,
			context,
			requestSignal,
		);
		return { ...result, classifier };
	}

	const textResult = await checkJevContentFilter(
		messages,
		context,
		requestSignal,
	);

	// Text-only requests are the common case: skip the OpenAI credential lookup
	// and the no-op moderation call entirely when there is no image to cover.
	if (
		!options.imagesAllowed ||
		buildOpenAIContentFilterImageInputs(messages).length === 0 ||
		!(await hasOpenAIContentFilterCredential())
	) {
		return { ...textResult, classifier };
	}

	const imageResult = await checkOpenAIContentFilter(
		messages,
		context,
		requestSignal,
		{ kinds: ["image"] },
	);

	// The OpenAI filter fails open by returning no results, and the delegation
	// only runs when the request actually carries images — so an empty result
	// here is a failed image check, not an absent one.
	if (imageResult.results.length === 0) {
		return { ...textResult, classifier, imageModerationFailed: true };
	}

	logger.debug("gateway_content_filter_image_delegated", {
		requestId: context.requestId,
		organizationId: context.organizationId,
		classifier,
		imageResults: imageResult.results.length,
	});

	return {
		classifier,
		flagged: textResult.flagged || imageResult.flagged,
		model: textResult.model,
		upstreamRequestId:
			textResult.upstreamRequestId ?? imageResult.upstreamRequestId,
		results: [...textResult.results, ...imageResult.results],
		responses: [...textResult.responses, ...imageResult.responses],
	};
}

/**
 * Score a request with the tier's deciding classifier, optionally alongside the
 * configured shadow classifier, and build the evaluation stored on the log.
 *
 * Null when the deciding classifier cannot run for this organization (excluded
 * by its compliance policy, or no credential configured) — the same skip as a
 * deployment with no moderation credential at all, so the filter never fails a
 * customer request over its own unavailability. A shadow classifier that cannot
 * run is simply left out; it never blocks the deciding verdict.
 */
export async function evaluateContentFilterWithClassifiers(options: {
	plan: TieredContentFilterPlan;
	messages: BaseMessage[];
	context: GatewayContentFilterContext;
	signal?: AbortSignal;
	/** Whether the organization's policy permits OpenAI (image delegation). */
	imagesAllowed: boolean;
	classifierAllowed: (classifier: ContentFilterClassifier) => boolean;
	/** Result already computed for this request, reused when its classifier matches. */
	existing?: ContentFilterCheckResult | null;
}): Promise<{
	evaluation: GatewayContentFilterEvaluation;
	results: ContentFilterCheckResult[];
} | null> {
	const { plan, messages, context, signal, existing } = options;

	/** Whether this classifier may run at all, before any provider call. */
	const eligible = async (classifier: ContentFilterClassifier) =>
		existing?.classifier === classifier ||
		(options.classifierAllowed(classifier) &&
			(await hasClassifierCredential(classifier)));

	const run = async (
		classifier: ContentFilterClassifier,
	): Promise<ContentFilterCheckResult> =>
		existing?.classifier === classifier
			? existing
			: await runContentFilterClassifier(
					classifier,
					messages,
					context,
					signal,
					{ imagesAllowed: options.imagesAllowed },
				);

	const [decidingEligible, shadowEligible] = await Promise.all([
		eligible(plan.classifier),
		plan.shadowClassifier ? eligible(plan.shadowClassifier) : false,
	]);

	// Nothing to decide with, so the shadow run is never paid for either.
	if (!decidingEligible) {
		return null;
	}

	// Both classifiers run in parallel: the caller is holding the client's
	// request open across this, and each provider call has its own multi-minute
	// timeout, so awaiting them in sequence would put the shadow run's full
	// latency in front of the user for a verdict it is not allowed to change.
	const [decidingSettled, shadowSettled] = await Promise.allSettled([
		run(plan.classifier),
		plan.shadowClassifier && shadowEligible
			? run(plan.shadowClassifier)
			: Promise.resolve(null),
	]);

	// A cancellation is the only thing either call rethrows, and both share the
	// request's signal — so the deciding rejection carries it and the shadow's
	// identical one is left alone rather than surfacing unhandled.
	if (decidingSettled.status === "rejected") {
		throw decidingSettled.reason;
	}

	const deciding = decidingSettled.value;
	const evaluation = evaluateTieredContentFilter(deciding.results, plan.level);
	const results = [deciding];

	let shadow:
		| {
				classifier: ContentFilterClassifier;
				evaluation: ReturnType<typeof evaluateTieredContentFilter>;
				moderationFailed: boolean;
		  }
		| undefined;
	const shadowResult =
		shadowSettled.status === "fulfilled" ? shadowSettled.value : null;
	if (plan.shadowClassifier && shadowResult) {
		shadow = {
			classifier: plan.shadowClassifier,
			evaluation: evaluateTieredContentFilter(shadowResult.results, plan.level),
			moderationFailed: moderationFailed(shadowResult),
		};
		results.push(shadowResult);
	}

	return {
		evaluation: buildGatewayContentFilterEvaluation(
			plan,
			evaluation,
			moderationFailed(deciding),
			shadow,
		),
		results,
	};
}
