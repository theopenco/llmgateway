import type { LogErrorCategory, LogInsertData } from "@llmgateway/db";

export function getLogErrorCategory(
	log: Pick<
		LogInsertData,
		"hasError" | "finishReason" | "usedProvider" | "errorDetails"
	>,
): LogErrorCategory | null {
	if (
		log.finishReason === "llmgateway_content_filter" ||
		log.errorDetails?.cause === "guardrail_violation"
	) {
		return "guardrail";
	}
	if (!log.hasError) {
		return null;
	}
	if (log.finishReason === "gateway_error") {
		return "gateway";
	}
	if (log.usedProvider !== "llmgateway") {
		return "upstream";
	}
	switch (log.errorDetails?.statusCode) {
		case 401:
			return "authentication";
		case 402:
			return "billing";
		case 403:
		case 410:
			return "permission";
		case 429:
			return "rate_limit";
		default:
			return (log.errorDetails?.statusCode ?? 400) >= 500
				? "gateway"
				: "validation";
	}
}
