import { isProviderIdCompliant } from "@/lib/compliance.js";

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
import type {
	ContentFilterClassifier,
	ContentFilterInternalScope,
} from "@llmgateway/shared";

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
	/** The text-only classifier's own time; unset when OpenAI decided. */
	classifierDurationMs?: number;
	/** Calls the internal classifier made, one per chunk. */
	classifierRequests?: number;
	/** Time of the image moderation delegated to OpenAI, when it ran. */
	imageDurationMs?: number;
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

interface ContentFilterRunOptions {
	/** Whether the organization's policy permits OpenAI (image delegation). */
	imagesAllowed: boolean;
	/** False when an admin turned image moderation off: images skip it by design. */
	moderateImages?: boolean;
	/** What the internal classifier reads. Defaults to the whole conversation. */
	internalScope?: ContentFilterInternalScope;
}

/**
 * Run one classifier over a request's content.
 *
 * Jev and the internal classifier are text-only, so image parts are moderated
 * through OpenAI and merged in — but only when image moderation is on, the
 * organization's compliance policy permits OpenAI (`imagesAllowed`), and a
 * credential exists.
 * Without that, such a request carries no image coverage at all rather than
 * silently sending image data to a provider the policy excluded.
 */
export async function runContentFilterClassifier(
	classifier: ContentFilterClassifier,
	messages: BaseMessage[],
	context: GatewayContentFilterContext,
	requestSignal: AbortSignal | undefined,
	options: ContentFilterRunOptions,
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
	options: ContentFilterRunOptions,
): Promise<Omit<ContentFilterCheckResult, "durationMs">> {
	if (classifier === "openai") {
		const result = await checkOpenAIContentFilter(
			messages,
			context,
			requestSignal,
		);
		return { ...result, classifier };
	}

	const textStartTime = performance.now();
	const {
		requestCount,
		...textResult
	}: OpenAIContentFilterCheckResult & {
		partialModerationFailed?: boolean;
		requestCount?: number;
	} =
		classifier === "internal"
			? await checkInternalContentFilter(
					messages,
					context,
					requestSignal,
					options.internalScope,
				)
			: await checkJevContentFilter(messages, context, requestSignal);
	const timings = {
		classifierDurationMs: Math.round(performance.now() - textStartTime),
		...(requestCount !== undefined ? { classifierRequests: requestCount } : {}),
	};

	if (
		options.moderateImages === false ||
		buildOpenAIContentFilterImageInputs(messages).length === 0
	) {
		return { ...textResult, ...timings, classifier };
	}
	if (!options.imagesAllowed || !(await hasOpenAIContentFilterCredential())) {
		return {
			...textResult,
			...timings,
			classifier,
			partialModerationFailed: true,
		};
	}

	const imageStartTime = performance.now();
	const imageResult = await checkOpenAIContentFilter(
		messages,
		context,
		requestSignal,
		{ kinds: ["image"] },
	);
	const imageDurationMs = Math.round(performance.now() - imageStartTime);

	// Both filters fail open by returning no results, and the delegation only
	// runs when the request actually carries images — so an empty result on
	// either side is a failed check, not an absent one.
	const textFailed =
		textResult.results.length === 0 ||
		textResult.partialModerationFailed === true;
	if (imageResult.results.length === 0) {
		return {
			...textResult,
			...timings,
			imageDurationMs,
			classifier,
			partialModerationFailed: true,
		};
	}

	logger.debug("gateway_content_filter_image_delegated", {
		requestId: context.requestId,
		organizationId: context.organizationId,
		classifier,
		imageResults: imageResult.results.length,
	});

	return {
		classifier,
		...timings,
		imageDurationMs,
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
 * Score a request with the tier's classifier and build the evaluation stored on
 * the log.
 *
 * Null when the classifier cannot run for this organization (excluded by its
 * compliance policy, or no credential configured) — the same skip as a
 * deployment with no moderation credential at all, so the filter never fails a
 * customer request over its own unavailability.
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

	let result: ContentFilterCheckResult;
	if (existing?.classifier === plan.classifier) {
		result = existing;
	} else {
		if (
			!options.classifierAllowed(plan.classifier) ||
			!(await hasClassifierCredential(plan.classifier))
		) {
			return null;
		}
		result = await runContentFilterClassifier(
			plan.classifier,
			messages,
			context,
			signal,
			{
				imagesAllowed: options.imagesAllowed,
				moderateImages: plan.moderateImages,
				internalScope: plan.internalScope,
			},
		);
	}

	return {
		evaluation: buildGatewayContentFilterEvaluation(
			plan,
			evaluateTieredContentFilter(result.results, plan.level),
			moderationFailed(result),
			result.durationMs,
			{
				classifierDurationMs: result.classifierDurationMs,
				classifierRequests: result.classifierRequests,
				imageDurationMs: result.imageDurationMs,
			},
		),
		results: [result],
	};
}
