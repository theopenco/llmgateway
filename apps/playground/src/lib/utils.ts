import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getStringErrorMessage(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const message = value.trim();
	if (!message) {
		return null;
	}

	if (!message.startsWith("{") && !message.startsWith("[")) {
		return message;
	}

	try {
		return getErrorMessage(JSON.parse(message));
	} catch {
		return message;
	}
}

export function getErrorMessage(error: unknown): string {
	if (!error) {
		return "An unknown error occurred";
	}

	const stringMessage = getStringErrorMessage(error);
	if (stringMessage) {
		return stringMessage;
	}

	// Check candidate objects for specific error structures
	if (!isRecord(error)) {
		return "An unknown error occurred";
	}

	const candidates = [
		error,
		error.error,
		error.data,
		error.response,
		isRecord(error.response) ? error.response.data : undefined,
	];

	for (const candidate of candidates) {
		if (!isRecord(candidate)) {
			continue;
		}

		const candidateStringMessage =
			getStringErrorMessage(candidate.error) ??
			getStringErrorMessage(candidate.message);
		if (candidateStringMessage) {
			return candidateStringMessage;
		}

		// Handle Zod-OpenAPI default error format
		if (candidate.success === false && candidate.error) {
			if (
				isRecord(candidate.error) &&
				Array.isArray(candidate.error.issues) &&
				candidate.error.issues.length > 0
			) {
				const issue = candidate.error.issues[0];
				if (isRecord(issue)) {
					const issueMessage = getStringErrorMessage(issue.message);
					if (issueMessage) {
						return issueMessage;
					}
				}
			}
		}
	}

	// Handle standard Error object or { message: ... }
	const errorMessage = getStringErrorMessage(error.message);
	if (errorMessage) {
		return errorMessage;
	}

	return "An unknown error occurred";
}
