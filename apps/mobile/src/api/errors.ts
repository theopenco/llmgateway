export class ApiError extends Error {
	public constructor(
		message: string,
		public status: number,
	) {
		super(message);
	}
}

export function errorMessage(payload: unknown, fallback: string): string {
	if (!payload || typeof payload !== "object") {
		return fallback;
	}
	if ("message" in payload && typeof payload.message === "string") {
		return payload.message;
	}
	if ("error" in payload) {
		if (typeof payload.error === "string") {
			return payload.error;
		}
		if (
			payload.error &&
			typeof payload.error === "object" &&
			"message" in payload.error &&
			typeof payload.error.message === "string"
		) {
			return payload.error.message;
		}
	}
	return fallback;
}

export async function assertResponseOk(response: Response) {
	if (response.ok) {
		return response;
	}
	const body = await response.text();
	let message = `Request failed (${response.status}). Please try again.`;
	try {
		message = errorMessage(JSON.parse(body), message);
	} catch {
		/* Non-JSON errors retain their HTTP status. */
	}
	throw new ApiError(message, response.status);
}
