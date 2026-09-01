import {
	discountedPriceValues,
	effectiveUnitPrice,
	roundPerUnit,
} from "./pricing-schedule";

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
	const values = discountedPriceValues(perImagePrice, discount);
	if (values.length === 0) {
		return null;
	}
	const min = Math.min(...values);
	const max = Math.max(...values);
	return min === max
		? formatPerUnitPrice(min)
		: `${formatPerUnitPrice(min)} – ${formatPerUnitPrice(max)}`;
}

/** Formats a per-unit (image/second/1K chars) price, e.g. "$0.0467". */
export function formatPerUnitPrice(value: number): string {
	return `$${roundPerUnit(value)}`;
}

/**
 * Label for a per-second price map: the default_video/default_audio pair as
 * "$a – $b", else the default tier as "$a". `original` is the label before
 * discount. Callers add "/sec" and handle the null (no default tier) case.
 */
export function formatPerSecondPriceLabel(
	perSecondPrice: Record<string, string | number>,
	discount?: string | null,
	multiplier = 1,
): { value: string; original: string; tiers: string[] } | null {
	const label = (tiers: string[], d?: string | null): string | null => {
		const parts: string[] = [];
		for (const tier of tiers) {
			const price = effectiveUnitPrice(perSecondPrice[tier], d);
			if (price === null) {
				return null;
			}
			parts.push(formatPerUnitPrice(price * multiplier));
		}
		return parts.join(" – ");
	};
	for (const tiers of [["default_video", "default_audio"], ["default"]]) {
		const value = label(tiers, discount);
		if (value !== null) {
			return { value, original: label(tiers) ?? value, tiers };
		}
	}
	return null;
}
