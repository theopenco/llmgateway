import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	getUpstreamPostTtftStallMs,
	getUpstreamPreTtftStallMs,
} from "./timeout-config.js";

describe("upstream stall thresholds", () => {
	const originalPre = process.env.UPSTREAM_PRE_TTFT_STALL_MS;
	const originalPost = process.env.UPSTREAM_POST_TTFT_STALL_MS;

	beforeEach(() => {
		delete process.env.UPSTREAM_PRE_TTFT_STALL_MS;
		delete process.env.UPSTREAM_POST_TTFT_STALL_MS;
	});

	afterEach(() => {
		if (originalPre === undefined) {
			delete process.env.UPSTREAM_PRE_TTFT_STALL_MS;
		} else {
			process.env.UPSTREAM_PRE_TTFT_STALL_MS = originalPre;
		}
		if (originalPost === undefined) {
			delete process.env.UPSTREAM_POST_TTFT_STALL_MS;
		} else {
			process.env.UPSTREAM_POST_TTFT_STALL_MS = originalPost;
		}
	});

	it("uses 60s pre-TTFT default when env var unset", () => {
		expect(getUpstreamPreTtftStallMs()).toBe(60000);
	});

	it("uses 30s post-TTFT default when env var unset", () => {
		expect(getUpstreamPostTtftStallMs()).toBe(30000);
	});

	it("respects pre-TTFT env override", () => {
		process.env.UPSTREAM_PRE_TTFT_STALL_MS = "120000";
		expect(getUpstreamPreTtftStallMs()).toBe(120000);
	});

	it("respects post-TTFT env override", () => {
		process.env.UPSTREAM_POST_TTFT_STALL_MS = "5000";
		expect(getUpstreamPostTtftStallMs()).toBe(5000);
	});

	it("treats 0 as a disable signal (returned as-is)", () => {
		process.env.UPSTREAM_PRE_TTFT_STALL_MS = "0";
		process.env.UPSTREAM_POST_TTFT_STALL_MS = "0";
		expect(getUpstreamPreTtftStallMs()).toBe(0);
		expect(getUpstreamPostTtftStallMs()).toBe(0);
	});

	it("treats negative values as a disable signal (returned as-is)", () => {
		process.env.UPSTREAM_PRE_TTFT_STALL_MS = "-1";
		process.env.UPSTREAM_POST_TTFT_STALL_MS = "-1";
		expect(getUpstreamPreTtftStallMs()).toBe(-1);
		expect(getUpstreamPostTtftStallMs()).toBe(-1);
	});

	it("falls back to defaults when env value is non-numeric", () => {
		process.env.UPSTREAM_PRE_TTFT_STALL_MS = "not-a-number";
		process.env.UPSTREAM_POST_TTFT_STALL_MS = "also-bad";
		expect(getUpstreamPreTtftStallMs()).toBe(60000);
		expect(getUpstreamPostTtftStallMs()).toBe(30000);
	});

	it("falls back to defaults when env value is empty string", () => {
		process.env.UPSTREAM_PRE_TTFT_STALL_MS = "";
		process.env.UPSTREAM_POST_TTFT_STALL_MS = "";
		expect(getUpstreamPreTtftStallMs()).toBe(60000);
		expect(getUpstreamPostTtftStallMs()).toBe(30000);
	});
});
