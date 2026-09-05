import {
	CLAW_FORK_PATTERN,
	CODING_AGENTS,
	LEGACY_LOUNGE_SOURCE,
	LOUNGE_SOURCE,
} from "@llmgateway/shared";

const logSources = new Set([
	...CODING_AGENTS.flatMap((agent) => [agent.id, ...agent.xSourceValues]),
	LOUNGE_SOURCE,
	LEGACY_LOUNGE_SOURCE,
	"docs-ask-ai",
	"support-chat",
	"onboarding",
	"llmgateway.io/playground",
	"chatbox",
	"continue.dev",
	"bolt.new",
	"v0.dev",
	"lovable.dev",
]);

export function normalizeLogSource(
	source: string | null | undefined,
): string | null {
	if (!source) {
		return null;
	}

	const normalized = source.replace(/^https?:\/\//, "").replace(/^www\./, "");
	if (logSources.has(normalized)) {
		return normalized;
	}

	// Keep wildcard agent recognition from creating unbounded aggregation keys.
	return CLAW_FORK_PATTERN.test(normalized) ? "openclaw" : "unknown";
}
