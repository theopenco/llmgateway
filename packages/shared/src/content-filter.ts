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
 */
const CONTENT_FILTER_ERROR_SIGNALS = [
	"ResponsibleAIPolicyViolation",
	"SensitiveContentDetected",
	"data_inspection_failed",
	"Input data may contain inappropriate content",
	"Green net check failed",
	"Microsoft's content management policy",
	"Your request was rejected by the safety system",
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
