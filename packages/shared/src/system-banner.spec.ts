import { describe, expect, test } from "vitest";

import {
	isValidSystemBannerLink,
	normalizeSystemBanner,
	parseSystemBanner,
	serializeSystemBanner,
	SYSTEM_BANNER_LINK_LABEL_MAX_LENGTH,
	SYSTEM_BANNER_MESSAGE_MAX_LENGTH,
} from "./system-banner.js";

describe("normalizeSystemBanner", () => {
	test("returns null without a message", () => {
		expect(normalizeSystemBanner({ message: "   " })).toBeNull();
		expect(normalizeSystemBanner({})).toBeNull();
	});

	test("defaults an unknown severity to info", () => {
		expect(normalizeSystemBanner({ message: "hi", severity: "nope" })).toEqual({
			message: "hi",
			severity: "info",
			linkUrl: null,
			linkLabel: null,
		});
	});

	test("drops the label when there is no link", () => {
		expect(
			normalizeSystemBanner({
				message: "hi",
				severity: "warning",
				linkLabel: "Status",
			}),
		).toEqual({
			message: "hi",
			severity: "warning",
			linkUrl: null,
			linkLabel: null,
		});
	});

	test("truncates message and label", () => {
		const banner = normalizeSystemBanner({
			message: "a".repeat(SYSTEM_BANNER_MESSAGE_MAX_LENGTH + 20),
			linkUrl: "https://status.llmgateway.io",
			linkLabel: "b".repeat(SYSTEM_BANNER_LINK_LABEL_MAX_LENGTH + 20),
		});
		expect(banner?.message).toHaveLength(SYSTEM_BANNER_MESSAGE_MAX_LENGTH);
		expect(banner?.linkLabel).toHaveLength(SYSTEM_BANNER_LINK_LABEL_MAX_LENGTH);
	});
});

describe("isValidSystemBannerLink", () => {
	test("accepts https urls only", () => {
		expect(isValidSystemBannerLink("https://status.llmgateway.io")).toBe(true);
		expect(isValidSystemBannerLink("http://status.llmgateway.io")).toBe(false);
		expect(isValidSystemBannerLink("/status")).toBe(false);
		expect(isValidSystemBannerLink("javascript:alert(1)")).toBe(false);
		expect(isValidSystemBannerLink("not a url")).toBe(false);
	});
});

describe("parseSystemBanner", () => {
	test("round-trips a serialized banner", () => {
		const banner = {
			message: "Upstream provider degraded",
			severity: "warning" as const,
			linkUrl: "https://status.llmgateway.io/",
			linkLabel: "Status",
		};
		expect(parseSystemBanner(serializeSystemBanner(banner))).toEqual(banner);
	});

	test("returns null for empty or malformed values", () => {
		expect(parseSystemBanner(null)).toBeNull();
		expect(parseSystemBanner("")).toBeNull();
		expect(parseSystemBanner("{not json")).toBeNull();
		expect(parseSystemBanner("[]")).toBeNull();
		expect(parseSystemBanner('{"severity":"info"}')).toBeNull();
	});
});
