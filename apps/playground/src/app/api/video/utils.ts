export async function readGatewayResponseBody(
	response: Response,
): Promise<unknown> {
	const text = await response.text();
	if (!text) {
		return null;
	}

	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
}

export function getGatewayErrorMessage(
	body: unknown,
	fallbackMessage: string,
): string {
	if (typeof body === "string" && body.length > 0) {
		return body;
	}

	if (body && typeof body === "object") {
		if ("message" in body && typeof body.message === "string") {
			return body.message;
		}

		if ("error" in body) {
			const error = (body as { error: unknown }).error;
			if (typeof error === "string" && error.length > 0) {
				return error;
			}
			if (
				error &&
				typeof error === "object" &&
				"message" in error &&
				typeof (error as { message: unknown }).message === "string"
			) {
				return (error as { message: string }).message;
			}
		}
	}

	return fallbackMessage;
}
