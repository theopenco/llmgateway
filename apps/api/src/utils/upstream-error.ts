import { APICallError, StreamProviderError } from "ai";

// Provider failures relayed by the gateway, which already logs them.
export function isUpstreamError(error: unknown): boolean {
	return (
		StreamProviderError.isInstance(error) || APICallError.isInstance(error)
	);
}
