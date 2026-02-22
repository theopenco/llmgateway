import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/**
 * Formats a context size number into a human-readable string with k/M suffixes
 * @param contextSize - The context size in tokens
 * @returns Formatted string (e.g., "128k", "1M", "—")
 */
export function formatContextSize(contextSize?: number): string {
	if (!contextSize) {
		return "—";
	}
	if (contextSize >= 1000000) {
		return `${(contextSize / 1000000).toFixed(contextSize % 1000000 === 0 ? 0 : 1)}M`;
	}
	if (contextSize >= 1000) {
		return `${(contextSize / 1000).toFixed(contextSize % 1000 === 0 ? 0 : 1)}k`;
	}
	return contextSize.toString();
}

/**
 * Formats a deprecation or deactivation date with past/future tense awareness.
 * @param date - The date as a Date object or ISO string
 * @param type - "deprecated" or "deactivated"
 * @returns Formatted string like "Deprecated since Jan 21, 2026" or "Deprecating on Mar 15, 2026"
 */
export function formatDeprecationDate(
	date: Date | string,
	type: "deprecated" | "deactivated",
): string {
	const d = typeof date === "string" ? new Date(date) : date;
	const now = new Date();
	const isPast = d <= now;
	const formatted = d.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});

	if (type === "deprecated") {
		return isPast
			? `Deprecated since ${formatted}`
			: `Deprecating on ${formatted}`;
	}
	return isPast
		? `Deactivated since ${formatted}`
		: `Deactivating on ${formatted}`;
}
