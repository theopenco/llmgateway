import { z } from "@hono/zod-openapi";

import type { ProviderCacheControlMode } from "@llmgateway/models";

export const providerCacheControlModeSchema = z.enum([
	"auto",
	"passthrough",
	"off",
]);

/**
 * Resolve the mode a request asked for, accepting the pre-passthrough boolean.
 *
 * `providerCacheControlEnabled` predates the three-way setting and is still
 * sent by existing API clients, so it stays accepted: `true` restores the
 * gateway's marker injection ("auto") and `false` strips everything ("off").
 * An explicit mode always wins, since only it can express "passthrough".
 */
export function resolveProviderCacheControlMode(input: {
	providerCacheControlMode?: ProviderCacheControlMode;
	providerCacheControlEnabled?: boolean;
}): ProviderCacheControlMode | undefined {
	if (input.providerCacheControlMode !== undefined) {
		return input.providerCacheControlMode;
	}
	if (input.providerCacheControlEnabled !== undefined) {
		return input.providerCacheControlEnabled ? "auto" : "off";
	}
	return undefined;
}

/**
 * Add the legacy boolean to a project row so responses stay backwards
 * compatible. "passthrough" reports as enabled because markers do still reach
 * the provider — only "off" suppresses cache writes outright.
 */
export function withLegacyProviderCacheControl<
	T extends { providerCacheControlMode: ProviderCacheControlMode },
>(project: T): T & { providerCacheControlEnabled: boolean } {
	return {
		...project,
		providerCacheControlEnabled: project.providerCacheControlMode !== "off",
	};
}
