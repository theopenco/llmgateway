// Runware can reject an internal thinking flag absent from our request. This
// specific rejection is a provider failure; actual invalid parameters stay 400s.
export function isRunwareThinkingError(
	provider: string,
	status: number,
	errorText: string,
	requestBody: unknown,
): boolean {
	if (
		provider !== "runware" ||
		status !== 400 ||
		!requestBody ||
		typeof requestBody !== "object" ||
		"chat_template_kwargs" in requestBody
	) {
		return false;
	}

	try {
		const payload: unknown = JSON.parse(errorText);
		if (!payload || typeof payload !== "object" || !("error" in payload)) {
			return false;
		}
		const error = payload.error;
		return (
			!!error &&
			typeof error === "object" &&
			"type" in error &&
			error.type === "invalid_request_error" &&
			"code" in error &&
			error.code === "invalid_value" &&
			"param" in error &&
			error.param === "chat_template_kwargs.enable_thinking" &&
			"message" in error &&
			error.message ===
				"Unsupported parameter 'chat_template_kwargs.enable_thinking'; use 'reasoning_effort'."
		);
	} catch {
		return false;
	}
}
