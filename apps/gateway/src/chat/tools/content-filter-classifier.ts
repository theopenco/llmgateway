import { isProviderIdCompliant } from "@/lib/compliance.js";

import { logger, toError } from "@llmgateway/logger";

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
	buildContentFilterShadowVerdict,
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

/**
 * Whether a check covered everything it set out to cover. Every failed call
 * leaves an error, so one failed image among several successful ones counts.
 */
function moderationFailed(result: ContentFilterCheckResult): boolean {
	return (
		result.results.length === 0 ||
		result.partialModerationFailed === true ||
		result.errors.length > 0
	);
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

/** Whether the organization's policy allows a classifier and it is configured. */
async function isClassifierAvailable(
	classifier: ContentFilterClassifier,
	options: {
		classifierAllowed: (classifier: ContentFilterClassifier) => boolean;
	},
): Promise<boolean> {
	return (
		options.classifierAllowed(classifier) &&
		(await hasClassifierCredential(classifier))
	);
}

/**
 * Whether the plan's deciding classifier can produce a verdict. Without one
 * there is no evaluation to attach shadow verdicts to.
 */
export async function isDecidingClassifierAvailable(options: {
	plan: TieredContentFilterPlan;
	classifierAllowed: (classifier: ContentFilterClassifier) => boolean;
	existing?: ContentFilterCheckResult | null;
}): Promise<boolean> {
	return (
		options.existing?.classifier === options.plan.classifier ||
		(await isClassifierAvailable(options.plan.classifier, options))
	);
}

interface ContentFilterRunOptions {
	/** Whether the organization's policy permits OpenAI (image delegation). */
	imagesAllowed: boolean;
	/** What the internal classifier reads. Defaults to the whole conversation. */
	internalScope?: ContentFilterInternalScope;
	/** What OpenAI moderation reads of the text. Defaults to the latest turn. */
	openaiScope?: ContentFilterInternalScope;
}

/**
 * Run one classifier over a request's content.
 *
 * Jev and the internal classifier are text-only, so image parts are moderated
 * through OpenAI and merged in — but only when `imagesAllowed` says image
 * delegation is on, the organization's compliance policy permits OpenAI, and
 * a credential exists.
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
			{ scope: options.openaiScope },
		);
		return { ...result, classifier };
	}

	// The image delegation runs alongside the text check, not after it, so a
	// request with images waits for the slower of the two rather than both.
	const [text, image] = await Promise.all([
		runTextCheck(classifier, messages, context, requestSignal, options),
		options.imagesAllowed &&
		buildOpenAIContentFilterImageInputs(messages).length > 0
			? runImageCheck(messages, context, requestSignal)
			: null,
	]);
	const {
		requestCount,
		durationMs: classifierDurationMs,
		...textResult
	} = text;
	const timings = {
		classifierDurationMs,
		...(requestCount !== undefined ? { classifierRequests: requestCount } : {}),
	};

	if (!image) {
		return { ...textResult, ...timings, classifier };
	}
	const { durationMs: imageDurationMs, ...imageResult } = image;

	// Both filters fail open by returning no results, and the delegation only
	// runs when the request actually carries images — so an empty result on
	// either side is a failed check, not an absent one.
	const textFailed =
		textResult.results.length === 0 ||
		textResult.partialModerationFailed === true;
	const errors = [...textResult.errors, ...imageResult.errors];
	if (imageResult.results.length === 0) {
		return {
			...textResult,
			...timings,
			imageDurationMs,
			classifier,
			errors,
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
		errors,
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
}): Promise<ContentFilterOutcome | null> {
	const { plan, messages, context, signal, existing } = options;

	let result: ContentFilterCheckResult;
	if (existing?.classifier === plan.classifier) {
		result = existing;
	} else {
		if (!(await isClassifierAvailable(plan.classifier, options))) {
			return null;
		}
		result = await runContentFilterClassifier(
			plan.classifier,
			messages,
			context,
			signal,
			{
				imagesAllowed: options.imagesAllowed && plan.moderateImages,
				internalScope: plan.internalScope,
				openaiScope: plan.openaiScope,
			},
		);
	}

	return {
		evaluation: buildGatewayContentFilterEvaluation(
			plan,
			evaluateTieredContentFilter(
				result.results,
				plan.level,
				plan.csamScoreThreshold,
			),
			moderationFailed(result),
			result.durationMs,
			{
				classifierDurationMs: result.classifierDurationMs,
				classifierRequests: result.classifierRequests,
				imageDurationMs: result.imageDurationMs,
				moderationErrors: result.errors,
			},
		),
		results: [result],
	};
}

interface ContentFilterOutcome {
	evaluation: GatewayContentFilterEvaluation;
	results: ContentFilterCheckResult[];
}

/**
 * Run the plan's shadow classifiers over the request, in parallel and detached
 * from the client's signal. Each runs as it would if it decided (same scope,
 * same image delegation), so a classifier's flag rate stays comparable across
 * setups. A shadow that cannot run for this organization, or fails, is left
 * out; it never affects the request.
 */
export async function runShadowContentFilters(
	options: Omit<
		Parameters<typeof evaluateContentFilterWithClassifiers>[0],
		"signal"
	>,
): Promise<ContentFilterCheckResult[]> {
	const { plan, messages, context, existing } = options;
	const settled = await Promise.allSettled(
		plan.shadowClassifiers.map(async (classifier) => {
			if (existing?.classifier === classifier) {
				return existing;
			}
			if (!(await isClassifierAvailable(classifier, options))) {
				return null;
			}
			return await runContentFilterClassifier(
				classifier,
				messages,
				context,
				undefined,
				{
					imagesAllowed: options.imagesAllowed && plan.moderateImages,
					internalScope: plan.internalScope,
					openaiScope: plan.openaiScope,
				},
			);
		}),
	);
	const results: ContentFilterCheckResult[] = [];
	for (const [index, outcome] of settled.entries()) {
		if (outcome.status === "rejected") {
			logger.warn("Shadow content filter failed", {
				requestId: context.requestId,
				organizationId: context.organizationId,
				classifier: plan.shadowClassifiers[index],
				error: toError(outcome.reason),
			});
		} else if (outcome.value) {
			results.push(outcome.value);
		}
	}
	return results;
}

/** Attach shadow verdicts, and their raw responses, to the deciding outcome. */
export function withShadowVerdicts(
	plan: TieredContentFilterPlan,
	outcome: ContentFilterOutcome,
	shadows: ContentFilterCheckResult[],
): ContentFilterOutcome {
	if (shadows.length === 0) {
		return outcome;
	}
	return {
		evaluation: {
			...outcome.evaluation,
			shadows: shadows.map((result) =>
				buildContentFilterShadowVerdict(
					plan,
					result.classifier,
					evaluateTieredContentFilter(
						result.results,
						plan.level,
						plan.csamScoreThreshold,
					),
					moderationFailed(result),
					result.durationMs,
					{
						classifierDurationMs: result.classifierDurationMs,
						classifierRequests: result.classifierRequests,
						imageDurationMs: result.imageDurationMs,
						moderationErrors: result.errors,
					},
				),
			),
		},
		results: [
			...outcome.results,
			...shadows.filter((result) => !outcome.results.includes(result)),
		],
	};
}

async function runTextCheck(
	classifier: Exclude<ContentFilterClassifier, "openai">,
	messages: BaseMessage[],
	context: GatewayContentFilterContext,
	requestSignal: AbortSignal | undefined,
	options: ContentFilterRunOptions,
): Promise<
	OpenAIContentFilterCheckResult & {
		partialModerationFailed?: boolean;
		requestCount?: number;
		durationMs: number;
	}
> {
	const startTime = performance.now();
	const result =
		classifier === "internal"
			? await checkInternalContentFilter(
					messages,
					context,
					requestSignal,
					options.internalScope,
				)
			: await checkJevContentFilter(messages, context, requestSignal);
	return { ...result, durationMs: Math.round(performance.now() - startTime) };
}

/** OpenAI moderation of the image parts; null without an OpenAI credential. */
async function runImageCheck(
	messages: BaseMessage[],
	context: GatewayContentFilterContext,
	requestSignal: AbortSignal | undefined,
): Promise<(OpenAIContentFilterCheckResult & { durationMs: number }) | null> {
	if (!(await hasOpenAIContentFilterCredential())) {
		return null;
	}
	const startTime = performance.now();
	const result = await checkOpenAIContentFilter(
		messages,
		context,
		requestSignal,
		{ kinds: ["image"] },
	);
	return { ...result, durationMs: Math.round(performance.now() - startTime) };
}
