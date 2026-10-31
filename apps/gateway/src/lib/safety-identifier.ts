export function getClientSafetyIdentifierParams(body: unknown): {
	safety_identifier?: string;
} {
	if (!body || typeof body !== "object") {
		return {};
	}
	const request = body as Record<string, unknown>;
	const value = request.safety_identifier ?? request.user;
	return typeof value === "string" && value.length > 0 && value.length <= 128
		? { safety_identifier: value }
		: {};
}
