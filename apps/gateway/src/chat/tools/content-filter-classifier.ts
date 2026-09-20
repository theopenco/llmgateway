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

	if (imageResult.results.length === 0) {
		return { ...textResult, classifier };
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

	const run = async (
		classifier: ContentFilterClassifier,
	): Promise<ContentFilterCheckResult | null> => {
		if (existing?.classifier === classifier) {
			return existing;
		}
		if (!options.classifierAllowed(classifier)) {
			return null;
		}
		if (!(await hasClassifierCredential(classifier))) {
			return null;
		}
		return await runContentFilterClassifier(
			classifier,
			messages,
			context,
			signal,
			{
				imagesAllowed: options.imagesAllowed,
			},
		);
	};

	const deciding = await run(plan.classifier);
	if (!deciding) {
		return null;
	}

	const evaluation = evaluateTieredContentFilter(deciding.results, plan.level);
	const results = [deciding];

	let shadow:
		| {
				classifier: ContentFilterClassifier;
				evaluation: ReturnType<typeof evaluateTieredContentFilter>;
				moderationFailed: boolean;
		  }
		| undefined;
	if (plan.shadowClassifier) {
		const shadowResult = await run(plan.shadowClassifier);
		if (shadowResult) {
			shadow = {
				classifier: plan.shadowClassifier,
				evaluation: evaluateTieredContentFilter(
					shadowResult.results,
					plan.level,
				),
				moderationFailed: shadowResult.results.length === 0,
			};
			results.push(shadowResult);
		}
	}

	return {
		evaluation: buildGatewayContentFilterEvaluation(
			plan,
			evaluation,
			deciding.results.length === 0,
			shadow,
		),
		results,
	};
}
