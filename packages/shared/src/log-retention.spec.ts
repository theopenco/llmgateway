import { describe, expect, it } from "vitest";

import {
	getLogRetentionCutoff,
	isRoutingMetadataExpired,
} from "./log-retention.js";

const now = new Date("2026-09-12T12:00:00Z");
const expiredAt = "2026-08-12T12:00:00Z";

describe("routing metadata expiration", () => {
	it("uses the same exact 30-day boundary as cleanup", () => {
		expect(getLogRetentionCutoff(now).toISOString()).toBe(
			"2026-08-13T12:00:00.000Z",
		);
		expect(
			isRoutingMetadataExpired(
				{ createdAt: getLogRetentionCutoff(now), routingMetadata: null },
				now,
			),
		).toBe(false);
	});

	it("shows expiration for removed metadata on an old log", () => {
		expect(
			isRoutingMetadataExpired(
				{ createdAt: expiredAt, routingMetadata: null },
				now,
			),
		).toBe(true);
	});

	it("does not label recent missing metadata as expired", () => {
		expect(
			isRoutingMetadataExpired({ createdAt: now, routingMetadata: null }, now),
		).toBe(false);
	});

	it.each([undefined, { selectedProvider: "openai" }])(
		"does not label omitted or retained metadata as expired (%j)",
		(routingMetadata) => {
			expect(
				isRoutingMetadataExpired(
					{ createdAt: expiredAt, routingMetadata },
					now,
				),
			).toBe(false);
		},
	);
});
