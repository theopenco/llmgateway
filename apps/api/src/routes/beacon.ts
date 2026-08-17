import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { getClientIpFromContext } from "@/lib/client-ip.js";
import { posthog } from "@/posthog.js";

import { logger } from "@llmgateway/logger";

import type { ServerTypes } from "@/vars.js";

export const beacon = new OpenAPIHono<ServerTypes>();

const beaconDataSchema = z.object({
	uuid: z.string().uuid("Must be a valid UUID"),
	type: z.string().min(1, "Type is required"),
	timestamp: z.string().datetime("Must be a valid ISO datetime"),
	version: z.string().min(1, "Version is required"),
	providers: z.array(z.string()).default([]),
});

const beaconRoute = createRoute({
	method: "post",
	path: "/beacon",
	request: {
		body: {
			content: {
				"application/json": {
					schema: beaconDataSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						message: z.string(),
					}),
				},
			},
			description: "Beacon data received successfully",
		},
	},
});

/**
 * Extracts region/country information from request headers
 */
function extractRegionInfo(c: any): { country?: string; region?: string } {
	const result: { country?: string; region?: string } = {};

	// Cloudflare provides country code
	const cfCountry = c.req.header("CF-IPCountry");
	if (cfCountry && cfCountry !== "XX") {
		// XX is unknown country in Cloudflare
		result.country = cfCountry;
	}

	// Cloudflare also provides region/state
	const cfRegion = c.req.header("CF-Region");
	if (cfRegion) {
		result.region = cfRegion;
	}

	// GCP Cloud Load Balancer headers (if available)
	const gclbRegion = c.req.header("X-Google-Cloud-Region");
	if (gclbRegion && !result.region) {
		result.region = gclbRegion;
	}

	return result;
}

beacon.openapi(beaconRoute, async (c) => {
	const beaconData = c.req.valid("json");

	// Extract IP and region information
	const clientIP = getClientIpFromContext(c);
	const regionInfo = extractRegionInfo(c);

	// Determine cloud provider based on headers
	const cloudProvider = c.req.header("CF-Ray")
		? "cloudflare"
		: c.req.header("X-Google-Cloud-Region") ||
			  c.req.header("X-Cloud-Trace-Context")
			? "gcp"
			: "unknown";

	// Send the installation data to PostHog for anonymous tracking
	posthog.capture({
		distinctId: beaconData.uuid,
		event: "self_hosted_installation_beacon",
		properties: {
			installation: beaconData.type,
			timestamp: beaconData.timestamp,
			source: "self_hosted_api",
			version: beaconData.version,
			client_ip: clientIP,
			country: regionInfo.country,
			region: regionInfo.region,
			providers: beaconData.providers,
			providers_count: beaconData.providers.length,
		},
	});

	logger.info("Received installation beacon", {
		uuid: beaconData.uuid,
		type: beaconData.type,
		clientIP,
		country: regionInfo.country,
		cloudProvider,
		providersCount: beaconData.providers.length,
	});

	return c.json({
		success: true,
		message: "Beacon received successfully",
	});
});
