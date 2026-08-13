import { describe, expect, it } from "vitest";

import { describeNetworkFailure } from "./network-error.js";

/** The shape undici produces: an opaque TypeError wrapping the real reason. */
function fetchFailed(cause: unknown): TypeError {
	return new TypeError("fetch failed", { cause });
}

function errnoError(message: string, code: string): Error {
	return Object.assign(new Error(message), { code });
}

describe("describeNetworkFailure", () => {
	it("names the unresolvable host instead of reporting 'fetch failed'", () => {
		const failure = describeNetworkFailure(
			fetchFailed(
				errnoError(
					"getaddrinfo ENOTFOUND my-resource.openai.azure.com",
					"ENOTFOUND",
				),
			),
			"https://my-resource.openai.azure.com/openai/deployments/x/chat/completions?api-version=2024-10-21",
		);

		expect(failure?.code).toBe("ENOTFOUND");
		expect(failure?.message).toContain("my-resource.openai.azure.com");
		expect(failure?.message).toContain("DNS lookup failed");
		expect(failure?.message).not.toContain("fetch failed");
	});

	// undici reports a connect failure across several resolved addresses as an
	// AggregateError, which carries no `code` of its own.
	it("digs the code out of an AggregateError", () => {
		const aggregate = new AggregateError([
			errnoError("connect ECONNREFUSED 10.0.0.1:443", "ECONNREFUSED"),
		]);
		const failure = describeNetworkFailure(
			fetchFailed(aggregate),
			"https://api.example.com/v1/chat/completions",
		);

		expect(failure?.code).toBe("ECONNREFUSED");
		expect(failure?.message).toContain("api.example.com");
		expect(failure?.message).toContain("refused the connection");
	});

	it.each([
		["UND_ERR_CONNECT_TIMEOUT", "timed out"],
		["ECONNRESET", "closed before a response arrived"],
		["CERT_HAS_EXPIRED", "TLS handshake"],
	])("classifies %s", (code, expected) => {
		const failure = describeNetworkFailure(
			fetchFailed(errnoError(code, code)),
			"https://api.example.com/v1/chat/completions",
		);

		expect(failure?.code).toBe(code);
		expect(failure?.message).toContain(expected);
	});

	it("explains an unfollowed redirect", () => {
		const failure = describeNetworkFailure(
			fetchFailed(new Error("unexpected redirect")),
			"https://api.example.com/v1/chat/completions",
		);

		expect(failure?.code).toBe("UNEXPECTED_REDIRECT");
		expect(failure?.message).toContain("redirect");
	});

	// The endpoint of an api-key-in-query-string provider must never reach an
	// error message or a log line in full.
	it("reports the host only, never the query string", () => {
		const failure = describeNetworkFailure(
			fetchFailed(errnoError("getaddrinfo EAI_AGAIN host", "EAI_AGAIN")),
			"https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=AIzaSySECRET",
		);

		expect(failure?.message).toContain("generativelanguage.googleapis.com");
		expect(failure?.message).not.toContain("AIzaSySECRET");
	});

	it("still classifies an unknown fetch failure as unreachable", () => {
		const failure = describeNetworkFailure(
			fetchFailed(new Error("something went wrong at the socket layer")),
			"https://api.example.com/v1/chat/completions",
		);

		expect(failure?.code).toBe("FETCH_FAILED");
		expect(failure?.message).toContain("Could not reach api.example.com");
	});

	// Bugs on our side must keep their error-level treatment.
	it("ignores errors that are not connectivity failures", () => {
		expect(
			describeNetworkFailure(
				new Error("No suitable validation model found for provider openai"),
				"https://api.openai.com/v1/chat/completions",
			),
		).toBeUndefined();
		expect(describeNetworkFailure("not an error")).toBeUndefined();
	});

	it("falls back to a generic target when there is no endpoint", () => {
		const failure = describeNetworkFailure(
			fetchFailed(errnoError("getaddrinfo ENOTFOUND host", "ENOTFOUND")),
		);

		expect(failure?.message).toContain("the provider endpoint");
	});
});
