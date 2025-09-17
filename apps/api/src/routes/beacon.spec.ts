import { describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import { posthog } from "@/posthog.js";

// Mock PostHog
vi.mock("@/posthog", () => ({
	posthog: {
		capture: vi.fn(),
	},
}));

describe("beacon endpoint", () => {
	it("should accept valid beacon data", async () => {
		const beaconData = {
			uuid: "123e4567-e89b-12d3-a456-426614174000",
			type: "self-host",
			timestamp: "2024-01-01T00:00:00.000Z",
			version: "v0.0.0-unknown",
		};

		const response = await app.request("/beacon", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(beaconData),
		});

		expect(response.status).toBe(200);
		const responseData = await response.json();
		expect(responseData).toEqual({
			success: true,
			message: "Beacon received successfully",
		});

		// Verify PostHog was called with correct data including new tracking fields
		expect(posthog.capture).toHaveBeenCalledWith({
			distinctId: beaconData.uuid,
			event: "self_hosted_installation_beacon",
			properties: {
				installation: beaconData.type,
				timestamp: beaconData.timestamp,
				source: "self_hosted_api",
				version: process.env.APP_VERSION || "v0.0.0-unknown",
				client_ip: null, // No IP headers provided
				country: undefined,
				region: undefined,
			},
		});
	});

	it("should extract Cloudflare headers correctly", async () => {
		const beaconData = {
			uuid: "123e4567-e89b-12d3-a456-426614174000",
			type: "self-host",
			timestamp: "2024-01-01T00:00:00.000Z",
			version: "v0.0.0-unknown",
		};

		const response = await app.request("/beacon", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": "203.0.113.42",
				"CF-IPCountry": "US",
				"CF-Region": "California",
				"CF-Ray": "8a1b2c3d4e5f6789-SJC",
			},
			body: JSON.stringify(beaconData),
		});

		expect(response.status).toBe(200);

		// Verify PostHog was called with Cloudflare data
		expect(posthog.capture).toHaveBeenCalledWith({
			distinctId: beaconData.uuid,
			event: "self_hosted_installation_beacon",
			properties: {
				installation: beaconData.type,
				timestamp: beaconData.timestamp,
				source: "self_hosted_api",
				version: process.env.APP_VERSION || "v0.0.0-unknown",
				client_ip: "203.0.113.42",
				country: "US",
				region: "California",
			},
		});
	});

	it("should extract GCP headers correctly", async () => {
		const beaconData = {
			uuid: "123e4567-e89b-12d3-a456-426614174000",
			type: "self-host",
			timestamp: "2024-01-01T00:00:00.000Z",
			version: "v0.0.0-unknown",
		};

		const response = await app.request("/beacon", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Forwarded-For": "198.51.100.25, 203.0.113.1",
				"X-Google-Cloud-Region": "us-central1",
				"X-Cloud-Trace-Context": "105445aa7843bc8bf206b120001000/1;o=1",
			},
			body: JSON.stringify(beaconData),
		});

		expect(response.status).toBe(200);

		// Verify PostHog was called with GCP data
		expect(posthog.capture).toHaveBeenCalledWith({
			distinctId: beaconData.uuid,
			event: "self_hosted_installation_beacon",
			properties: {
				installation: beaconData.type,
				timestamp: beaconData.timestamp,
				source: "self_hosted_api",
				version: process.env.APP_VERSION || "v0.0.0-unknown",
				client_ip: "198.51.100.25", // First IP from X-Forwarded-For
				country: undefined, // GCP doesn't provide country in standard headers
				region: "us-central1",
			},
		});
	});

	it("should handle X-Real-IP fallback", async () => {
		const beaconData = {
			uuid: "123e4567-e89b-12d3-a456-426614174000",
			type: "self-host",
			timestamp: "2024-01-01T00:00:00.000Z",
			version: "v0.0.0-unknown",
		};

		const response = await app.request("/beacon", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Real-IP": "192.0.2.123",
			},
			body: JSON.stringify(beaconData),
		});

		expect(response.status).toBe(200);

		// Verify PostHog was called with X-Real-IP data
		expect(posthog.capture).toHaveBeenCalledWith({
			distinctId: beaconData.uuid,
			event: "self_hosted_installation_beacon",
			properties: {
				installation: beaconData.type,
				timestamp: beaconData.timestamp,
				source: "self_hosted_api",
				version: process.env.APP_VERSION || "v0.0.0-unknown",
				client_ip: "192.0.2.123",
				country: undefined,
				region: undefined,
			},
		});
	});

	it("should reject invalid UUID", async () => {
		const beaconData = {
			uuid: "invalid-uuid",
			type: "self-host",
			timestamp: "2024-01-01T00:00:00.000Z",
			version: "v0.0.0-unknown",
		};

		const response = await app.request("/beacon", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(beaconData),
		});

		expect(response.status).toBe(400);
	});

	it("should reject invalid timestamp", async () => {
		const beaconData = {
			uuid: "123e4567-e89b-12d3-a456-426614174000",
			type: "self-host",
			timestamp: "invalid-timestamp",
		};

		const response = await app.request("/beacon", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(beaconData),
		});

		expect(response.status).toBe(400);
	});

	it("should reject missing fields", async () => {
		const beaconData = {
			uuid: "123e4567-e89b-12d3-a456-426614174000",
			// missing type and timestamp
		};

		const response = await app.request("/beacon", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(beaconData),
		});

		expect(response.status).toBe(400);
	});
});
