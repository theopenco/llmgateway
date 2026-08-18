import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getGithubCopilotToken } from "./github-copilot-token.js";

vi.mock("@llmgateway/cache", () => ({
	redisClient: {
		get: vi.fn().mockResolvedValue(null),
		ttl: vi.fn().mockResolvedValue(-2),
		set: vi.fn().mockResolvedValue("OK"),
	},
}));

const fetchMock = vi.fn();

beforeEach(() => {
	vi.stubGlobal("fetch", fetchMock);
	fetchMock.mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("getGithubCopilotToken", () => {
	it("exchanges the GitHub OAuth token for the Copilot bearer token", async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					token: "copilot-short-lived",
					expires_at: Math.floor(Date.now() / 1000) + 1800,
				}),
				{ status: 200 },
			),
		);

		const token = await getGithubCopilotToken("gho_exchange-test-1");
		expect(token).toBe("copilot-short-lived");

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.github.com/copilot_internal/v2/token");
		const headers = init.headers as Record<string, string>;
		expect(headers.Authorization).toBe("token gho_exchange-test-1");
		expect(headers["Copilot-Integration-Id"]).toBe("vscode-chat");
	});

	it("serves the second call from the in-process cache", async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					token: "copilot-cached",
					expires_at: Math.floor(Date.now() / 1000) + 1800,
				}),
				{ status: 200 },
			),
		);

		await getGithubCopilotToken("gho_exchange-test-2");
		const again = await getGithubCopilotToken("gho_exchange-test-2");
		expect(again).toBe("copilot-cached");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("reports a missing Copilot subscription as an auth failure", async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(JSON.stringify({ message: "Not Found" }), { status: 403 }),
		);

		await expect(getGithubCopilotToken("gho_exchange-test-3")).rejects.toThrow(
			/no active Copilot subscription/,
		);
	});
});
