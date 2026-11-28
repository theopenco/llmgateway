import { describe, expect, test } from "vitest";

import { upstreamUrlForLog } from "./upstream-url-for-log.js";

describe("upstreamUrlForLog", () => {
	test("drops the query string that carries the Vertex API key", () => {
		const url =
			"https://aiplatform.googleapis.com/v1/projects/p/locations/us-central1/publishers/google/models/veo:predictLongRunning?key=secret-key";
		const logged = upstreamUrlForLog(url);
		expect(logged).toBe(
			"https://aiplatform.googleapis.com/v1/projects/p/locations/us-central1/publishers/google/models/veo:predictLongRunning",
		);
		expect(logged).not.toContain("secret-key");
	});

	test("drops fragments and keeps the path", () => {
		expect(upstreamUrlForLog("https://example.com/a/b?x=1#frag")).toBe(
			"https://example.com/a/b",
		);
	});
});
