import { describe, expect, it } from "vitest";

import { extractErrorCause } from "./extract-error-cause.js";

describe("extractErrorCause", () => {
	it("returns undefined for non-Error values", () => {
		expect(extractErrorCause("string error")).toBeUndefined();
		expect(extractErrorCause(42)).toBeUndefined();
		expect(extractErrorCause(null)).toBeUndefined();
		expect(extractErrorCause(undefined)).toBeUndefined();
	});

	it("returns undefined for Error without cause", () => {
		expect(extractErrorCause(new Error("fetch failed"))).toBeUndefined();
	});

	it("extracts a single-level cause", () => {
		const inner = new Error("connect ECONNREFUSED 127.0.0.1:443");
		const outer = new Error("fetch failed", { cause: inner });
		expect(extractErrorCause(outer)).toBe(
			"Error: connect ECONNREFUSED 127.0.0.1:443",
		);
	});

	it("extracts a multi-level cause chain", () => {
		const deepest = new Error("connect ETIMEDOUT 10.0.0.1:443");
		const middle = new Error("Connect Timeout Error", { cause: deepest });
		middle.name = "ConnectTimeoutError";
		const outer = new Error("fetch failed", { cause: middle });

		expect(extractErrorCause(outer)).toBe(
			"ConnectTimeoutError: Connect Timeout Error -> Error: connect ETIMEDOUT 10.0.0.1:443",
		);
	});

	it("includes error code property when present", () => {
		const inner = new Error("Connect Timeout Error") as Error & {
			code: string;
		};
		inner.name = "ConnectTimeoutError";
		inner.code = "UND_ERR_CONNECT_TIMEOUT";

		const deepest = new Error("connect ETIMEDOUT 10.0.0.1:443");

		inner.cause = deepest;
		const outer = new Error("fetch failed", { cause: inner });

		expect(extractErrorCause(outer)).toBe(
			"ConnectTimeoutError: Connect Timeout Error (code: UND_ERR_CONNECT_TIMEOUT) -> Error: connect ETIMEDOUT 10.0.0.1:443",
		);
	});

	it("handles string cause", () => {
		const outer = new Error("fetch failed", {
			cause: "some string reason",
		});
		expect(extractErrorCause(outer)).toBe("some string reason");
	});

	it("stops at max depth of 5", () => {
		let current: Error = new Error("level 6");
		for (let i = 5; i >= 1; i--) {
			current = new Error(`level ${i}`, { cause: current });
		}
		const outer = new Error("top", { cause: current });

		const result = extractErrorCause(outer)!;
		// Should have 5 parts (stops at depth 5)
		const parts = result.split(" -> ");
		expect(parts).toHaveLength(5);
		expect(parts[0]).toBe("Error: level 1");
		expect(parts[4]).toBe("Error: level 5");
	});

	it("handles non-Error, non-string cause", () => {
		const outer = new Error("fetch failed", { cause: 42 });
		expect(extractErrorCause(outer)).toBeUndefined();
	});

	it("handles DNS resolution errors", () => {
		const inner = new Error(
			"getaddrinfo ENOTFOUND api.example.com",
		) as Error & {
			code: string;
		};
		inner.code = "ENOTFOUND";
		const outer = new TypeError("fetch failed", { cause: inner });

		expect(extractErrorCause(outer)).toBe(
			"Error: getaddrinfo ENOTFOUND api.example.com (code: ENOTFOUND)",
		);
	});

	it("handles TLS errors", () => {
		const inner = new Error("CERT_HAS_EXPIRED") as Error & { code: string };
		inner.code = "CERT_HAS_EXPIRED";
		const outer = new TypeError("fetch failed", { cause: inner });

		expect(extractErrorCause(outer)).toBe(
			"Error: CERT_HAS_EXPIRED (code: CERT_HAS_EXPIRED)",
		);
	});
});
