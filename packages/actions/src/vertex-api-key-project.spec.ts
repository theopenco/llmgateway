import { afterEach, describe, expect, it, vi } from "vitest";

import {
	parseVertexProjectFromError,
	resetVertexApiKeyProjectCache,
	routeProjectlessVertexEndpoint,
} from "./vertex-api-key-project.js";

const PROJECTLESS =
	"https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.1-pro-preview:generateContent?key=k";

function notFound(project: string) {
	return new Response(
		JSON.stringify({
			error: {
				code: 404,
				message: `Publisher Model \`projects/${project}/locations/us-central1/publishers/google/models/llmgateway-project-probe\` was not found or your project does not have access to it.`,
			},
		}),
		{ status: 404 },
	);
}

afterEach(() => {
	resetVertexApiKeyProjectCache();
});

describe("parseVertexProjectFromError", () => {
	it("extracts the project number", () => {
		expect(
			parseVertexProjectFromError(
				"Publisher Model `projects/123456/locations/us-central1/publishers/google/models/x` was not found",
			),
		).toBe("123456");
	});

	it("returns undefined without a project", () => {
		expect(parseVertexProjectFromError("API key not valid")).toBeUndefined();
	});
});

describe("routeProjectlessVertexEndpoint", () => {
	it("rebuilds a project-less endpoint with the probed project, once per key", async () => {
		const fetchImpl = vi.fn(async () => notFound("123456"));
		const rebuild = (project: string) => `rebuilt:${project}`;

		await expect(
			routeProjectlessVertexEndpoint(PROJECTLESS, "k", rebuild, fetchImpl),
		).resolves.toBe("rebuilt:123456");
		await expect(
			routeProjectlessVertexEndpoint(PROJECTLESS, "k", rebuild, fetchImpl),
		).resolves.toBe("rebuilt:123456");
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [probeUrl, init] = fetchImpl.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(probeUrl).toBe(
			"https://aiplatform.googleapis.com/v1/publishers/google/models/llmgateway-project-probe:generateContent?key=k",
		);
		expect(init.redirect).toBe("error");
	});

	it("keeps the endpoint when the probe yields no project", async () => {
		const fetchImpl = vi.fn(
			async () => new Response("API key not valid", { status: 400 }),
		);

		await expect(
			routeProjectlessVertexEndpoint(
				PROJECTLESS,
				"k",
				() => "rebuilt",
				fetchImpl,
			),
		).resolves.toBe(PROJECTLESS);
	});

	it("ignores a project in a non-404 or non-JSON response", async () => {
		for (const response of [
			() =>
				new Response(
					JSON.stringify({
						error: { message: "projects/999/locations/us-central1/x" },
					}),
					{ status: 403 },
				),
			() =>
				new Response("projects/999/locations/us-central1/x", {
					status: 404,
				}),
		]) {
			resetVertexApiKeyProjectCache();
			await expect(
				routeProjectlessVertexEndpoint(
					PROJECTLESS,
					"k",
					() => "rebuilt",
					vi.fn(async () => response()),
				),
			).resolves.toBe(PROJECTLESS);
		}
	});

	it("keeps the endpoint when the probe throws", async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error("network down");
		});

		await expect(
			routeProjectlessVertexEndpoint(
				PROJECTLESS,
				"k",
				() => "rebuilt",
				fetchImpl,
			),
		).resolves.toBe(PROJECTLESS);
	});

	it("probes a proxy base URL through the proxy, cached per base URL", async () => {
		const fetchImpl = vi.fn(async () => notFound("123456"));
		const proxied =
			"https://vertex-proxy.example/api/v1/publishers/google/models/m:streamGenerateContent?key=k&alt=sse";
		const rebuild = (project: string) => `rebuilt:${project}`;

		await expect(
			routeProjectlessVertexEndpoint(proxied, "k", rebuild, fetchImpl),
		).resolves.toBe("rebuilt:123456");
		await expect(
			routeProjectlessVertexEndpoint(PROJECTLESS, "k", rebuild, fetchImpl),
		).resolves.toBe("rebuilt:123456");
		expect(
			(fetchImpl.mock.calls as unknown as [string][]).map(([url]) => url),
		).toEqual([
			"https://vertex-proxy.example/api/v1/publishers/google/models/llmgateway-project-probe:generateContent?key=k",
			"https://aiplatform.googleapis.com/v1/publishers/google/models/llmgateway-project-probe:generateContent?key=k",
		]);
	});

	it("leaves project-scoped, regional-host and token-less endpoints untouched", async () => {
		const fetchImpl = vi.fn(async () => notFound("123456"));
		const scoped =
			"https://aiplatform.googleapis.com/v1/projects/p/locations/global/publishers/google/models/m:generateContent?key=k";
		const regional =
			"https://us-central1-aiplatform.googleapis.com/v1/publishers/google/models/m:generateContent?key=k";

		for (const [url, token] of [
			[scoped, "k"],
			[regional, "k"],
			[PROJECTLESS, undefined],
		] as const) {
			await expect(
				routeProjectlessVertexEndpoint(url, token, () => "rebuilt", fetchImpl),
			).resolves.toBe(url);
		}
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});
