import { OpenAPIHono } from "@hono/zod-openapi";
import { makeBadge } from "badge-maker";
import { Decimal } from "decimal.js";

import {
	isLiveMapping,
	isTokenPricedMapping,
	models as modelDefinitions,
	type ModelDefinition,
} from "@llmgateway/models";

import {
	cachedMeasuredHistory,
	findStatusPageProvider,
} from "./public-providers-status.js";

import type { ServerTypes } from "@/vars.js";
import type { Context } from "hono";

/**
 * Embeddable SVG badges for READMEs and websites. Plain routes rather than
 * OpenAPI ones: they return images, and the typed client has no use for them.
 */
export const publicBadges = new OpenAPIHono<ServerTypes>();

const BADGE_STYLES = ["flat", "flat-square", "for-the-badge"] as const;
type BadgeStyle = (typeof BADGE_STYLES)[number];

const CACHE_SECONDS = 300;
const TOKENS_PER_MILLION = 1_000_000;

function badgeStyle(value: string | undefined): BadgeStyle {
	return BADGE_STYLES.find((style) => style === value) ?? "flat";
}

function svgResponse(
	c: Context<ServerTypes>,
	badge: { label: string; message: string; color: string },
	status: 200 | 404 = 200,
) {
	// badge-maker escapes label and message; both also come from the catalogue
	// or our own numbers, never from the request.
	const svg = makeBadge({ ...badge, style: badgeStyle(c.req.query("style")) });
	return c.body(svg, status, {
		"Content-Type": "image/svg+xml; charset=utf-8",
		"Cache-Control":
			status === 200
				? `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`
				: "public, max-age=60",
		"X-Content-Type-Options": "nosniff",
	});
}

function notFound(c: Context<ServerTypes>) {
	return svgResponse(
		c,
		{ label: "LLM Gateway", message: "not found", color: "lightgrey" },
		404,
	);
}

/** Truncated, not rounded, so 99.996% never reads as a perfect 100%. */
export function formatUptime(uptime: number): string {
	if (uptime >= 100) {
		return "100%";
	}
	const hundredths = Math.floor(uptime * 100);
	return `${(hundredths / 100).toFixed(2)}%`;
}

export function uptimeColor(uptime: number): string {
	if (uptime >= 99.9) {
		return "brightgreen";
	}
	if (uptime >= 99) {
		return "green";
	}
	if (uptime >= 95) {
		return "yellow";
	}
	return "red";
}

publicBadges.get("/provider/:providerId/uptime.svg", async (c) => {
	const provider = findStatusPageProvider(c.req.param("providerId"));
	if (!provider) {
		return notFound(c);
	}
	const window = c.req.query("window") === "24h" ? "24h" : "90d";
	const measured = await cachedMeasuredHistory(provider.id);
	const { uptime } = window === "24h" ? measured.last24h : measured.last90d;
	return svgResponse(c, {
		label: `${provider.name} uptime (${window})`,
		message: uptime === null ? "no data" : formatUptime(uptime),
		color: uptime === null ? "lightgrey" : uptimeColor(uptime),
	});
});

function perMillion(price: string): string {
	const value = new Decimal(price).mul(TOKENS_PER_MILLION).toDecimalPlaces(4);
	if (value.isZero()) {
		return "free";
	}
	// Whole dollars stay bare; cents always show two digits ("$0.60").
	return `$${value.isInteger() ? value.toString() : value.toFixed(Math.max(2, value.decimalPlaces()))}`;
}

/**
 * The lowest live input + output price across a model's providers. Mappings
 * billed per image, second or request are skipped: their token prices are not
 * what a request costs.
 */
export function cheapestPrice(
	model: ModelDefinition,
	now: Date = new Date(),
): { inputPrice: string; outputPrice: string } | null {
	let best: { inputPrice: string; outputPrice: string } | null = null;
	let bestTotal: Decimal | null = null;
	for (const mapping of model.providers) {
		const { inputPrice, outputPrice } = mapping;
		if (
			inputPrice === undefined ||
			outputPrice === undefined ||
			!isTokenPricedMapping(mapping) ||
			!isLiveMapping(mapping, now)
		) {
			continue;
		}
		const total = new Decimal(inputPrice).plus(outputPrice);
		if (bestTotal === null || total.lt(bestTotal)) {
			bestTotal = total;
			best = { inputPrice, outputPrice };
		}
	}
	return best;
}

publicBadges.get("/model/:modelId/price.svg", (c) => {
	const modelId = c.req.param("modelId");
	const model = (modelDefinitions as readonly ModelDefinition[]).find(
		(candidate) =>
			candidate.id === modelId && candidate.family !== "llmgateway",
	);
	const price = model ? cheapestPrice(model) : null;
	if (!model || !price) {
		return notFound(c);
	}
	const input = perMillion(price.inputPrice);
	const output = perMillion(price.outputPrice);
	return svgResponse(c, {
		label: `${model.name ?? model.id} per 1M tokens`,
		message:
			input === "free" && output === "free"
				? "free"
				: `${input} in · ${output} out`,
		color: "blue",
	});
});
