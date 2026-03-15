import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function getErrorMessage(error: any): string {
	if (!error) {
		return "An unknown error occurred";
	}
	if (typeof error === "string") {
		return error;
	}

	// Check candidate objects for specific error structures
	const candidates = [
		error,
		error.error,
		error.data,
		error.response,
		error.response?.data,
	];

	for (const candidate of candidates) {
		if (!candidate || typeof candidate !== "object") {
			continue;
		}

		// Handle Zod-OpenAPI default error format
		if (candidate.success === false && candidate.error) {
			if (
				candidate.error.issues &&
				Array.isArray(candidate.error.issues) &&
				candidate.error.issues.length > 0
			) {
				return candidate.error.issues[0].message;
			}
			if (typeof candidate.error === "string") {
				return candidate.error;
			}
			if (candidate.error.message) {
				return candidate.error.message;
			}
		}
	}

	// Handle standard Error object or { message: ... }
	if (error.message) {
		return error.message;
	}

	return "An unknown error occurred";
}
