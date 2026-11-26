import { z } from "@hono/zod-openapi";

/** Components of a reply's cost in USD, keyed like chat's `cost_details`. */
export type UsageCostDetails = Record<string, number>;

/**
 * The cost every billed reply reports, in the shape chat completions use:
 * `usage.cost` is what the request was billed (the logged `cost`), and
 * `usage.cost_details` breaks it down.
 */
export interface UsageCost {
	cost: number;
	cost_details: UsageCostDetails & { total_cost: number };
}

export const usageCostSchema = {
	cost: z.number().optional().openapi({
		description: "What the request was billed, in USD at list price.",
		example: 0.00002,
	}),
	cost_details: z.record(z.string(), z.number()).optional().openapi({
		description:
			"The components of `cost` in USD, e.g. `input_cost` and `request_cost`; `total_cost` equals `cost`.",
	}),
};

/** `usage` of a route whose provider reports none of its own. */
export const usageWithCostSchema = z
	.object(usageCostSchema)
	.passthrough()
	.openapi({ description: "What the request was billed." });

export function usageCost(cost: number, details: UsageCostDetails): UsageCost {
	return { cost, cost_details: { ...details, total_cost: cost } };
}

/**
 * Returns the reply with its billed cost as `usage.cost` and
 * `usage.cost_details`, keeping any usage the provider reported. Pass the
 * same figure the request log records as `cost`, and in `quantities` what it
 * was billed on when the reply does not already report it in `usage`.
 */
export function withUsageCost<T extends object>(
	body: T,
	cost: number,
	details: UsageCostDetails,
	quantities: Record<string, unknown> = {},
): T & { usage: UsageCost } {
	const existing = (body as { usage?: unknown }).usage;
	const usage =
		existing && typeof existing === "object" && !Array.isArray(existing)
			? existing
			: {};
	return {
		...body,
		usage: { ...usage, ...quantities, ...usageCost(cost, details) },
	};
}
