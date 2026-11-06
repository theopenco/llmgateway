import { forwardedIpHeaders } from "@llmgateway/shared/client-ip";

/** Preserve caller security context only on trusted internal service hops. */
export function internalPrincipalHeaders(
	headers: Headers,
): Record<string, string> {
	const origin = headers.get("Origin");
	return {
		...forwardedIpHeaders(headers),
		...(origin !== null ? { Origin: origin } : {}),
	};
}
