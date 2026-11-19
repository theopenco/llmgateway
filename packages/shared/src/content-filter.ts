import { z } from "zod";

/** `system_setting` row holding the tiered gateway content filter settings. */
export const CONTENT_FILTER_SETTING_ID = "content_filter";

/**
 * Moderation model family the tiered filter scores requests with.
 * - `openai`: OpenAI's moderation endpoint (fixed categories, provider `flagged`
 *   bit honoured in strict mode).
 * - `jev`: TypeSafe's Jev decision model, asked one calibrated yes/no question
 *   per policy category. Text only — image parts go to OpenAI while
 *   `moderateImages` is on.
 * - `internal`: self-hosted classifier running in our own infrastructure. Its
 *   binary block verdict decides; topical tags are recorded only. Text only.
 */
export const CONTENT_FILTER_CLASSIFIERS = [
	"openai",
	"jev",
	"internal",
] as const;

export type ContentFilterClassifier =
	(typeof CONTENT_FILTER_CLASSIFIERS)[number];

/**
 * What the internal and OpenAI classifiers read.
 * - `full`: the whole conversation, split into chunks their size limits
 *   accept: all of it for the internal classifier, the newest 256 KiB for
 *   OpenAI. Slow on long agent histories.
 * - `latest_turn`: the system prompt plus the turn after the last assistant
 *   message.
 */
export const CONTENT_FILTER_INTERNAL_SCOPES = ["full", "latest_turn"] as const;

export type ContentFilterInternalScope =
	(typeof CONTENT_FILTER_INTERNAL_SCOPES)[number];

/** Model name on the internal classifier's stored moderation responses. */
export const INTERNAL_CLASSIFIER_MODEL = "internal-classifier";

/**
 * Policy groups the filter can block on, independent of the classifier's own
 * category names.
 */
export const CONTENT_FILTER_BLOCK_GROUPS = ["csam", "sexual", "cyber"] as const;

export type ContentFilterBlockGroup =
	(typeof CONTENT_FILTER_BLOCK_GROUPS)[number];

// OpenAI moderation categories and internal classifier tags.
const BLOCK_GROUP_CATEGORIES: Record<string, ContentFilterBlockGroup> = {
	"sexual/minors": "csam",
	child_exploitation: "csam",
	grooming_predation: "csam",
	direct_grooming: "csam",
	luring_isolation: "csam",
	sextortion_ibsa: "csam",
	impersonation_minor: "csam",
	image_based_coercion: "csam",
	sexual: "sexual",
	sexual_content: "sexual",
	nudify_tooling: "sexual",
	malware_cyber: "cyber",
	dark_market_tooling: "cyber",
};

// Internal classifier rule names (`reasons`), matched by prefix.
const BLOCK_GROUP_RULE_PREFIXES: [string, ContentFilterBlockGroup][] = [
	["minor_", "csam"],
	["grooming_", "csam"],
	["nudify_", "sexual"],
	["malware_", "cyber"],
	["cyber_", "cyber"],
];

/** Group of a moderation category or internal classifier tag. */
export function getContentFilterCategoryGroup(
	category: string,
): ContentFilterBlockGroup | null {
	return BLOCK_GROUP_CATEGORIES[category] ?? null;
}

/**
 * Group of an internal classifier rule. Unlike its tags, which all fire
 * together on a block, the rules name what triggered it.
 */
export function getContentFilterRuleGroup(
	rule: string,
): ContentFilterBlockGroup | null {
	for (const [prefix, group] of BLOCK_GROUP_RULE_PREFIXES) {
		if (rule.startsWith(prefix)) {
			return group;
		}
	}
	return null;
}

export const contentFilterSettingsSchema = z.object({
	// Master switch for sampling requests through the moderation API.
	enabled: z.boolean().default(true),
	// Providers whose routed requests are moderated. Empty = nobody.
	providerIds: z.array(z.string()).default([]),
	sampleRatePercent: z.number().min(0).max(100).default(100),
	// When false every violation is recorded as metadata but never blocked.
	enforce: z.boolean().default(false),
	// Providers that block (awaited before the provider call) even while
	// `enforce` is off. Always moderated, whether or not in `providerIds`.
	enforceProviderIds: z.array(z.string()).default([]),
	// Share of a blocking provider's requests checked in blocking mode. The
	// rest are monitored log-only at `sampleRatePercent`.
	enforceSampleRatePercent: z.number().min(0).max(100).default(100),
	// Extra blocking providers for DevPass orgs only, on top of
	// `enforceProviderIds`.
	devPassEnforceProviderIds: z.array(z.string()).default([]),
	// Enterprise orgs stay log-only unless this is also on.
	enforceEnterprise: z.boolean().default(false),
	// Classifier whose scores decide the outcome.
	classifier: z.enum(CONTENT_FILTER_CLASSIFIERS).default("openai"),
	// Classifiers that also score every sampled request, in the background and
	// in parallel, so flag rates compare per classifier on the same traffic.
	// Their verdicts are recorded, never enforced. The deciding one is skipped.
	shadowClassifiers: z.array(z.enum(CONTENT_FILTER_CLASSIFIERS)).default([]),
	internalScope: z.enum(CONTENT_FILTER_INTERNAL_SCOPES).default("full"),
	// What OpenAI moderation reads of the text; images are always read whole.
	openaiScope: z.enum(CONTENT_FILTER_INTERNAL_SCOPES).default("latest_turn"),
	// Whether a text-only classifier (jev, internal) hands image parts to
	// OpenAI moderation. Off leaves images unmoderated.
	moderateImages: z.boolean().default(true),
	// Groups whose matches block. Null blocks every matched category.
	blockGroups: z
		.array(z.enum(CONTENT_FILTER_BLOCK_GROUPS))
		.nullable()
		.default(null),
	// OpenAI `sexual/minors` score above which a request matches `csam` at
	// every tier, far below the general thresholds.
	csamScoreThreshold: z.number().min(0).max(1).default(0.01),
	// Whether requests the deciding classifier flags for `csam` or `sexual`
	// keep an encrypted copy of their payload for trust & safety review.
	preserveFlaggedPayloads: z.boolean().default(true),
});

export type ContentFilterSettings = z.infer<typeof contentFilterSettingsSchema>;

export const DEFAULT_CONTENT_FILTER_SETTINGS: ContentFilterSettings =
	contentFilterSettingsSchema.parse({});

/** Parse the stored JSON value; missing or invalid input yields the defaults. */
export function parseContentFilterSettings(
	value: string | null | undefined,
): ContentFilterSettings {
	if (!value) {
		return DEFAULT_CONTENT_FILTER_SETTINGS;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return DEFAULT_CONTENT_FILTER_SETTINGS;
	}
	const result = contentFilterSettingsSchema.safeParse(parsed);
	return result.success ? result.data : DEFAULT_CONTENT_FILTER_SETTINGS;
}

export const GATEWAY_CONTENT_FILTER_MESSAGE =
	"This request was blocked by LLM Gateway's content filter. This is the gateway's own filter, not the model provider's. Please contact LLM Gateway support at contact@llmgateway.io to make sure your requests do not violate the Terms of Use; support can review your use case and help you get unblocked.";

/**
 * Text fragments that uniquely identify a provider content-moderation / safety
 * block in an upstream error payload. Used to classify a request's finish reason
 * as `content_filter` rather than a generic upstream error.
 *
 * Covers chat, image, and video generation providers:
 * - Azure OpenAI: `ResponsibleAIPolicyViolation`, `content management policy`
 *   (the owner varies: "Microsoft's" / "Azure OpenAI's"), `ContentFiltered`
 * - ByteDance / DeepSeek (incl. Seedance video moderation, e.g.
 *   `OutputVideoSensitiveContentDetected`): `SensitiveContentDetected`
 * - Alibaba / DashScope: `data_inspection_failed`, `Green net check failed`
 *   (Wan video green-net moderation)
 * - OpenAI safety system (e.g. Sora / gpt-image): `rejected by the safety system`
 * - xAI video generation: `imagine:content-moderated`
 * - Z.AI / Zhipu (GLM, code 1301): `System detected potentially unsafe or
 *   sensitive content in input or generation`
 * - OpenAI cybersecurity policy: `cyber_policy`, `flagged for possible
 *   cybersecurity risk`
 * - MiniMax H3 Image (codes 1026/1027): `failed safety check`, `failed content
 *   safety check`
 */
const CONTENT_FILTER_ERROR_SIGNALS = [
	"ResponsibleAIPolicyViolation",
	"SensitiveContentDetected",
	"data_inspection_failed",
	"Input data may contain inappropriate content",
	"Green net check failed",
	"content management policy",
	"ContentFiltered",
	"Your request was rejected by the safety system",
	"imagine:content-moderated",
	"System detected potentially unsafe or sensitive content in input or generation",
	"cyber_policy",
	"flagged for possible cybersecurity risk",
	"failed safety check",
	"failed content safety check",
];

/**
 * Returns true when the provided upstream error text indicates a provider
 * content-moderation / safety block. Status-code-dependent cases (e.g. xAI's
 * 403 "Content violates usage guidelines") are intentionally excluded and must
 * be handled by the caller alongside the relevant status code.
 */
export function isContentFilterErrorText(
	text: string | null | undefined,
): boolean {
	if (!text) {
		return false;
	}

	const haystack = text.toLowerCase();
	if (
		CONTENT_FILTER_ERROR_SIGNALS.some((signal) =>
			haystack.includes(signal.toLowerCase()),
		)
	) {
		return true;
	}

	if (!haystack.includes("guardrail_violation")) {
		return false;
	}

	try {
		const payload: unknown = JSON.parse(text);
		if (!payload || typeof payload !== "object") {
			return false;
		}
		const error = "error" in payload ? payload.error : payload;
		return (
			!!error &&
			typeof error === "object" &&
			"type" in error &&
			error.type === "guardrail_violation"
		);
	} catch {
		return false;
	}
}
