// openapi-react-query rethrows openapi-fetch's parsed error body ({ message }),
// not an Error instance, so an `error instanceof Error` check alone silently
// drops every message the API sends and leaves the user with a generic toast.
export function getApiErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	if (
		error &&
		typeof error === "object" &&
		"message" in error &&
		typeof (error as { message?: unknown }).message === "string"
	) {
		return (error as { message: string }).message;
	}
	return fallback;
}
