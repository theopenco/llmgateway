import { getAzureUpstreamModel } from "@/chat/tools/resolve-platform-credential.js";

import type { RealtimePreflightResult } from "./preflight.js";

/**
 * Model name the session's mapping is addressed by upstream: an Azure
 * credential's `azure_deployment_name` override, else the mapping's id.
 */
export function getRealtimeUpstreamModel(
	preflight: Pick<
		RealtimePreflightResult,
		"match" | "providerKey" | "managedKey"
	>,
): string {
	const { providerId, externalId } = preflight.match.mapping;
	return providerId === "azure"
		? getAzureUpstreamModel(
				{
					providerKey: preflight.providerKey,
					managedKey: preflight.managedKey,
				},
				externalId,
			)
		: externalId;
}
