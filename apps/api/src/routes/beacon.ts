import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { posthog } from "@/posthog.js";
import { getCountryFromHeaders } from "@/utils/request-country.js";

import { logger } from "@llmgateway/logger";
import { getClientIpFromContext } from "@llmgateway/shared/client-ip";

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
function extractRegionInfo(headers: Headers): {
	country?: string;
	region?: string;
} {
	const result: { country?: string; region?: string } = {};

	// Country comes from whichever geo header the edge proxy in front of the API
	// attaches — GCP's X-Client-Region or Cloudflare's CF-IPCountry.
	result.country = getCountryFromHeaders(headers);

	// Cloudflare also provides region/state
	const cfRegion = headers.get("CF-Region");
	if (cfRegion) {
		result.region = cfRegion;
	}

	// GCP Cloud Load Balancer headers (if available)
	const gclbRegion = headers.get("X-Google-Cloud-Region");
	if (gclbRegion && !result.region) {
		result.region = gclbRegion;
	}

	return result;
}

beacon.openapi(beaconRoute, async (c) => {
	const beaconData = c.req.valid("json");

	// Extract IP and region information
	const clientIP = getClientIpFromContext(c);
	const regionInfo = extractRegionInfo(c.req.raw.headers);

	// Determine cloud provider based on headers
	const cloudProvider = c.req.header("CF-Ray")
		? "cloudflare"
		: c.req.header("X-Google-Cloud-Region") ||
			  c.req.header("X-Cloud-Trace-Context") ||
			  c.req.header("X-Client-Region")
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
