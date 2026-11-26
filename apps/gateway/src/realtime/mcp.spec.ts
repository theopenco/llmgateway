import { beforeEach, describe, expect, test, vi } from "vitest";

import { validateRealtimeTools } from "./mcp.js";

const mocks = vi.hoisted(() => ({
	resolve: vi.fn<(url: string) => Promise<URL>>(),
}));
vi.mock("@llmgateway/shared/url-safety-node", () => ({
	assertSafeResolvedUserUrl: mocks.resolve,
}));

function mcp(extra: Record<string, unknown> = {}) {
	return {
		type: "mcp",
		server_label: "public-tool",
		server_url: "https://mcp.example.com/api",
		...extra,
	};
}
function validate(
	tools: unknown,
	provider = "azure",
	signal = new AbortController().signal,
) {
	return validateRealtimeTools(tools, provider, signal);
}

describe("realtime MCP validation", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		mocks.resolve.mockReset();
		mocks.resolve.mockImplementation(async (url) => new URL(url));
	});

	test.each([
		undefined,
		null,
		[],
		[{ type: "function", name: "ping", parameters: { type: "object" } }],
	])("preserves existing function/no-tool configuration %j", async (tools) => {
		expect(await validate(tools)).toBeNull();
		expect(mocks.resolve).not.toHaveBeenCalled();
	});
	test.each([true, "mcp", {}, [null], [[]], [{ type: "web_search" }]])(
		"rejects unsupported tool configuration %j",
		async (tools) => {
			expect(await validate(tools)).not.toBeNull();
			expect(mocks.resolve).not.toHaveBeenCalled();
		},
	);
	test.each(["azure", "openai"])(
		"validates native MCP on %s without changing approvals or credentials",
		async (provider) => {
			const tools = [
				mcp({
					require_approval: {
						always: { tool_names: ["write"] },
						never: { tool_names: ["read"] },
					},
					allowed_tools: ["read", "write"],
					authorization: ["test", "credential"].join("-"),
					headers: { "X-Tenant": "fixture" },
				}),
			];
			const before = JSON.stringify(tools);
			expect(await validate(tools, provider)).toBeNull();
			expect(mocks.resolve).toHaveBeenCalledWith("https://mcp.example.com/api");
			expect(JSON.stringify(tools) === before).toBe(true);
		},
	);
	test.each(["xai", "google-ai-studio"])(
		"does not enable unsupported hosted tools on %s",
		async (provider) => {
			expect(await validate([mcp()], provider)).toMatchObject({
				code: "tools_not_supported",
			});
			expect(mocks.resolve).not.toHaveBeenCalled();
		},
	);
	test.each(["connector_id", "url", "oauth_url", "endpoint", "proxy_url"])(
		"rejects hidden or unsupported network targets in %s",
		async (field) => {
			expect(
				await validate([mcp({ [field]: "https://hidden.example.com" })]),
			).toMatchObject({ code: "invalid_mcp_tool" });
			expect(mocks.resolve).not.toHaveBeenCalled();
		},
	);
	test.each([
		"http://mcp.example.com/api",
		"ftp://mcp.example.com/api",
		"data:text/plain,tool",
		"not-a-url",
		"https://localhost/api",
		"https://127.0.0.1/api",
		"https://10.0.0.1/api",
		"https://169.254.169.254/metadata",
		"https://[::1]/api",
		"https://[::ffff:127.0.0.1]/api",
	])("rejects unsafe server URLs before DNS: %s", async (url) => {
		expect(await validate([mcp({ server_url: url })])).toMatchObject({
			code: "invalid_mcp_url",
		});
		expect(mocks.resolve).not.toHaveBeenCalled();
	});
	test("does not relax DNS safety when insecure provider overrides are enabled", async () => {
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "true");
		mocks.resolve.mockRejectedValue(new Error("private address"));
		expect(await validate([mcp()])).toMatchObject({ code: "invalid_mcp_url" });
		expect(mocks.resolve).toHaveBeenCalledTimes(1);
	});
	test("never returns URL credentials or resolver details in errors", async () => {
		const secret = ["test", "credential"].join("-");
		const error = await validate([
			mcp({ server_url: `https://fixture:${secret}@mcp.example.com` }),
		]);
		expect(error).toMatchObject({ code: "invalid_mcp_url" });
		expect(JSON.stringify(error).includes(secret)).toBe(false);
		mocks.resolve.mockRejectedValue(new Error(secret));
		const dnsError = await validate([mcp()]);
		expect(dnsError).toMatchObject({ code: "invalid_mcp_url" });
		expect(JSON.stringify(dnsError).includes(secret)).toBe(false);
	});
	test.each([
		null,
		[],
		{ Host: "private.internal" },
		{ ":authority": "private.internal" },
		{ Connection: "keep-alive" },
		{ Authorization: "fixture\r\nHost: private.internal" },
		{ Authorization: 42 },
	])(
		"rejects transport-header overrides and invalid headers %j",
		async (headers) => {
			expect(await validate([mcp({ headers })])).toMatchObject({
				code: "invalid_mcp_tool",
			});
			expect(mocks.resolve).not.toHaveBeenCalled();
		},
	);
	test("does not begin DNS validation after cancellation", async () => {
		const controller = new AbortController();
		controller.abort();
		expect(await validate([mcp()], "azure", controller.signal)).toMatchObject({
			code: "tools_validation_canceled",
		});
		expect(mocks.resolve).not.toHaveBeenCalled();
	});
	test("bounds slow DNS and cannot approve a late result", async () => {
		const deadline = new AbortController();
		vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
		let resolveDns!: (value: URL) => void;
		mocks.resolve.mockImplementation(
			() =>
				new Promise<URL>((resolve) => {
					resolveDns = resolve;
				}),
		);
		const result = validate([mcp(), mcp({ server_label: "second" })]);
		deadline.abort(new DOMException("deadline", "TimeoutError"));
		expect(await result).toMatchObject({ code: "tools_validation_timeout" });
		resolveDns(new URL("https://mcp.example.com/api"));
		await Promise.resolve();
		expect(mocks.resolve).toHaveBeenCalledTimes(1);
	});
	test("cancels slow DNS without waiting for an unabortable lookup", async () => {
		const controller = new AbortController();
		mocks.resolve.mockImplementation(() => new Promise<URL>(() => {}));
		const result = validate([mcp()], "azure", controller.signal);
		controller.abort();
		expect(await result).toMatchObject({ code: "tools_validation_canceled" });
	});
});
