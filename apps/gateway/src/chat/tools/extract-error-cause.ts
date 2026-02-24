/**
 * Walks the error.cause chain (up to 5 levels deep), extracting each nested
 * error's name, message, and code property (e.g., ECONNREFUSED, ENOTFOUND,
 * CERT_HAS_EXPIRED). Returns a human-readable string or undefined if no
 * cause chain exists.
 *
 * Example output:
 *   "ConnectTimeoutError: Connect Timeout Error (code: UND_ERR_CONNECT_TIMEOUT) -> Error: connect ETIMEDOUT 10.0.0.1:443"
 */
export function extractErrorCause(error: unknown): string | undefined {
	if (!(error instanceof Error) || !error.cause) {
		return undefined;
	}

	const parts: string[] = [];
	let current: unknown = error.cause;
	const maxDepth = 5;

	for (let i = 0; i < maxDepth && current; i++) {
		if (current instanceof Error) {
			let part = `${current.name}: ${current.message}`;
			const code = (current as Error & { code?: string }).code;
			if (code) {
				part += ` (code: ${code})`;
			}
			parts.push(part);
			current = current.cause;
		} else if (typeof current === "string") {
			parts.push(current);
			break;
		} else {
			break;
		}
	}

	return parts.length > 0 ? parts.join(" -> ") : undefined;
}
