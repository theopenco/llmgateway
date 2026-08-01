import { CLAW_FORK_PATTERN, CODING_AGENTS } from "@llmgateway/shared";

/**
 * Detects which coding agent made a request by inspecting the User-Agent header.
 * Used as a fallback when neither x-source nor HTTP-Referer identify the caller.
 */
export function detectCodingAgentFromUserAgent(
	userAgent: string | undefined,
): string | undefined {
	if (!userAgent) {
		return undefined;
	}

	const ua = userAgent.trim();
	if (!ua) {
		return undefined;
	}

	for (const agent of CODING_AGENTS) {
		for (const pattern of agent.userAgentPatterns) {
			if (pattern.test(ua)) {
				return agent.id;
			}
		}
	}

	// *claw fork fallback — any UA containing "claw" is treated as a claw-family tool
	if (CLAW_FORK_PATTERN.test(ua)) {
		const match = ua.match(/([\w-]*claw[\w-]*)/i);
		return match ? match[1].toLowerCase() : "claw-fork";
	}

	return undefined;
}
