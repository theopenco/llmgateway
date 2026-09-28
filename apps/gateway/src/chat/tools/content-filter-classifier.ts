import { isProviderIdCompliant } from "@/lib/compliance.js";
import { isCancellationError } from "@/lib/timeout-config.js";

import { logger } from "@llmgateway/logger";

import {
	checkInternalContentFilter,
	hasInternalContentFilterCredential,
} from "./internal-content-filter.js";
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
import type {
	BaseMessage,
	ProviderCompliancePolicy,
	ProviderId,
} from "@llmgateway/models";
import type { ContentFilterClassifier } from "@llmgateway/shared";

/**
 * The catalogue provider each classifier calls, for compliance gating. Null
 * for the internal classifier: it runs in our own infrastructure, so prompts
 * never reach a third party.
 */
const CONTENT_FILTER_CLASSIFIER_PROVIDERS: Record<
	ContentFilterClassifier,
	ProviderId | null
> = {
	openai: "openai",
	jev: "typesafe",
	internal: null,
};

/** Whether the organization's compliance policy lets this classifier run. */
export function isContentFilterClassifierCompliant(
	classifier: ContentFilterClassifier,
	compliancePolicy: ProviderCompliancePolicy | undefined,
): boolean {
	const provider = CONTENT_FILTER_CLASSIFIER_PROVIDERS[classifier];
	return (
		!compliancePolicy ||
		provider === null ||
		isProviderIdCompliant(provider, compliancePolicy)
	);
}

export interface ContentFilterCheckResult extends OpenAIContentFilterCheckResult {
	classifier: ContentFilterClassifier;
	/**
	 * Part of the check came back empty — the text scoring, or the image
	 * moderation delegated alongside it. Whatever did return still stands, so
	 * this never adds a violation; it is what stops the evaluation from
	 * recording a fully successful moderation when one half of a request went
	 * uncovered and the other half's results hide it.
	 */
	partialModerationFailed?: boolean;
	/** Wall-clock time of the whole check, including image delegation. */
	durationMs: number;
}

/** Whether a check covered everything it set out to cover. */
function moderationFailed(result: ContentFilterCheckResult): boolean {
	return result.results.length === 0 || result.partialModerationFailed === true;
}

export async function hasClassifierCredential(
	classifier: ContentFilterClassifier,
): Promise<boolean> {
	switch (classifier) {
		case "jev":
			return await hasJevContentFilterCredential();
		case "internal":
			return hasInternalContentFilterCredential();
		case "openai":
			return await hasOpenAIContentFilterCredential();
	}
}

/**
 * Run one classifier over a request's content.
 *
 * Jev and the internal classifier are text-only, so image parts are moderated
 * through OpenAI and merged in — but only when `imagesAllowed` says the
 * organization's compliance policy permits OpenAI and a credential exists.
 * Without that, such a request carries no image coverage at all rather than
 * silently sending image data to a provider the policy excluded.
 */
export async function runContentFilterClassifier(
	classifier: ContentFilterClassifier,
	messages: BaseMessage[],
	context: GatewayContentFilterContext,
	requestSignal: AbortSignal | undefined,
	options: { imagesAllowed: boolean },
): Promise<ContentFilterCheckResult> {
	const startTime = performance.now();
	const result = await runClassifierChecks(
		classifier,
		messages,
		context,
		requestSignal,
		options,
	);
	return {
		...result,
		durationMs: Math.round(performance.now() - startTime),
	};
}

async function runClassifierChecks(
	classifier: ContentFilterClassifier,
	messages: BaseMessage[],
	context: GatewayContentFilterContext,
	requestSignal: AbortSignal | undefined,
	options: { imagesAllowed: boolean },
): Promise<Omit<ContentFilterCheckResult, "durationMs">> {
	if (classifier === "openai") {
		const result = await checkOpenAIContentFilter(
			messages,
			context,
			requestSignal,
		);
		return { ...result, classifier };
	}

	const textResult: OpenAIContentFilterCheckResult & {
		partialModerationFailed?: boolean;
	} =
		classifier === "internal"
			? await checkInternalContentFilter(messages, context, requestSignal)
			: await checkJevContentFilter(messages, context, requestSignal);

	if (buildOpenAIContentFilterImageInputs(messages).length === 0) {
		return { ...textResult, classifier };
	}
	if (!options.imagesAllowed || !(await hasOpenAIContentFilterCredential())) {
		return { ...textResult, classifier, partialModerationFailed: true };
	}

	const imageResult = await checkOpenAIContentFilter(
		messages,
		context,
		requestSignal,
		{ kinds: ["image"] },
	);

	// Both filters fail open by returning no results, and the delegation only
	// runs when the request actually carries images — so an empty result on
	// either side is a failed check, not an absent one.
	const textFailed =
		textResult.results.length === 0 ||
		textResult.partialModerationFailed === true;
	if (imageResult.results.length === 0) {
		return { ...textResult, classifier, partialModerationFailed: true };
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
		// The image results would otherwise make a merged check that never
		// scored the request's text look complete.
		...(textFailed ? { partialModerationFailed: true } : {}),
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

	if (decidingSettled.status === "rejected") {
		throw decidingSettled.reason;
	}

	// The shadow run shares the request's signal, so its rejection can be the
	// only report that the client hung up (the deciding run may have already
	// finished, or reused an earlier result). Swallowing it would let the
	// caller carry on serving a request nobody is waiting for. Anything else
	// the shadow throws stays swallowed: it must never fail a request it is
	// not allowed to decide.
	if (
		shadowSettled.status === "rejected" &&
		(signal?.aborted || isCancellationError(shadowSettled.reason))
	) {
		throw shadowSettled.reason;
	}

	const deciding = decidingSettled.value;
	const evaluation = evaluateTieredContentFilter(deciding.results, plan.level);
	const results = [deciding];

	let shadow:
		| {
				classifier: ContentFilterClassifier;
				evaluation: ReturnType<typeof evaluateTieredContentFilter>;
				moderationFailed: boolean;
				durationMs: number;
		  }
		| undefined;
	const shadowResult =
		shadowSettled.status === "fulfilled" ? shadowSettled.value : null;
	if (plan.shadowClassifier && shadowResult) {
		shadow = {
			classifier: plan.shadowClassifier,
			evaluation: evaluateTieredContentFilter(shadowResult.results, plan.level),
			moderationFailed: moderationFailed(shadowResult),
			durationMs: shadowResult.durationMs,
		};
		results.push(shadowResult);
	}

	return {
		evaluation: buildGatewayContentFilterEvaluation(
			plan,
			evaluation,
			moderationFailed(deciding),
			deciding.durationMs,
			shadow,
		),
		results,
	};
}
