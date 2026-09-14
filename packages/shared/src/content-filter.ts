import { z } from "zod";

/** `system_setting` row holding the tiered gateway content filter settings. */
export const CONTENT_FILTER_SETTING_ID = "content_filter";

export const contentFilterSettingsSchema = z.object({
	// Master switch for sampling requests through the moderation API.
	enabled: z.boolean().default(true),
	// Providers whose routed requests are moderated. Empty = nobody.
	providerIds: z.array(z.string()).default([]),
	sampleRatePercent: z.number().min(0).max(100).default(100),
	// When false every violation is recorded as metadata but never blocked.
	enforce: z.boolean().default(false),
	// Enterprise orgs stay log-only unless this is also on.
	enforceEnterprise: z.boolean().default(false),
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
 * - Azure OpenAI: `ResponsibleAIPolicyViolation`, `Microsoft's content management policy`
 * - ByteDance / DeepSeek (incl. Seedance video moderation, e.g.
 *   `OutputVideoSensitiveContentDetected`): `SensitiveContentDetected`
 * - Alibaba / DashScope: `data_inspection_failed`, `Green net check failed`
 *   (Wan video green-net moderation)
 * - OpenAI safety system (e.g. Sora / gpt-image): `rejected by the safety system`
 * - xAI video generation: `imagine:content-moderated`
 * - Z.AI / Zhipu (GLM, code 1301): `System detected potentially unsafe or
 *   sensitive content in input or generation`
 */
const CONTENT_FILTER_ERROR_SIGNALS = [
	"ResponsibleAIPolicyViolation",
	"SensitiveContentDetected",
	"data_inspection_failed",
	"Input data may contain inappropriate content",
	"Green net check failed",
	"Microsoft's content management policy",
	"Your request was rejected by the safety system",
	"imagine:content-moderated",
	"System detected potentially unsafe or sensitive content in input or generation",
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

	return CONTENT_FILTER_ERROR_SIGNALS.some((signal) => text.includes(signal));
}
