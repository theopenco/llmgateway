import { discountFraction } from "@/lib/discount";

import { parseStrictPrice } from "./pricing-schedule";

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

/**
 * Formats a perImagePrice resolution-tier map as a discounted price range,
 * e.g. "$0.04 – $0.075" (or "$0.03" when every tier costs the same).
 * Callers append their own unit suffix (e.g. "/image").
 * @param perImagePrice - Resolution tier → USD-per-image price map
 * @param discount - Provider discount fraction as a string (e.g. "0.3")
 * @returns The formatted range, or null when the map has no finite prices
 */
export function formatPerImagePriceRange(
	perImagePrice: Record<string, string | number>,
	discount?: string | null,
): string | null {
	const d = discountFraction(discount);
	const values = Object.values(perImagePrice)
		.map((v) => parseStrictPrice(v))
		.filter((v): v is number => v !== null)
		.map((v) => (d > 0 ? v * (1 - d) : v));
	if (values.length === 0) {
		return null;
	}
	const fmt = (n: number) => `$${parseFloat(n.toFixed(4))}`;
	const min = Math.min(...values);
	const max = Math.max(...values);
	return min === max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`;
}
