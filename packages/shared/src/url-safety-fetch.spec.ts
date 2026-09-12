import { describe, expect, it, vi } from "vitest";

import { fetchSafeUserUrl } from "./url-safety-node.js";

import type { LookupFunction } from "node:net";

const mocks = vi.hoisted(() => ({
	agentOptions: [] as unknown[],
	dnsLookup: vi.fn(),
	fetch: vi.fn(),
}));

vi.mock("node:dns", () => ({
	lookup: mocks.dnsLookup,
}));

vi.mock("undici", () => ({
	Agent: class {
		public constructor(options: unknown) {
			mocks.agentOptions.push(options);
		}
	},
	fetch: mocks.fetch,
}));

describe("fetchSafeUserUrl", () => {
	it("forces redirect errors on every fetch", async () => {
		mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }));

		await fetchSafeUserUrl("https://mcp.example.com/rpc", {
			method: "POST",
			redirect: "follow",
		});

		expect(mocks.fetch).toHaveBeenCalledWith(
			new URL("https://mcp.example.com/rpc"),
			expect.objectContaining({
				method: "POST",
				redirect: "error",
				dispatcher: expect.anything(),
			}),
		);
	});

	it("rejects http before starting a fetch", async () => {
		mocks.fetch.mockClear();

		await expect(
			fetchSafeUserUrl("http://mcp.example.com/rpc"),
		).rejects.toThrow("must use https");
		expect(mocks.fetch).not.toHaveBeenCalled();
	});

	it("rejects unsafe addresses during socket DNS lookup", async () => {
		mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }));
		await fetchSafeUserUrl("https://mcp.example.com/rpc");

		const options = mocks.agentOptions[0] as {
			connect?: { lookup?: LookupFunction };
		};
		const safeLookup = options.connect?.lookup;
		expect(safeLookup).toBeDefined();

		mocks.dnsLookup.mockImplementationOnce(
			(
				_hostname: string,
				_options: unknown,
				callback: (
					error: NodeJS.ErrnoException | null,
					addresses: { address: string; family: number }[],
				) => void,
			) => {
				callback(null, [{ address: "127.0.0.1", family: 4 }]);
			},
		);

		const lookupError = await new Promise<NodeJS.ErrnoException | null>(
			(resolve) => {
				safeLookup?.("mcp.example.com", { all: true }, (error) => {
					resolve(error);
				});
			},
		);
		expect(lookupError?.code).toBe("EACCES");
	});
});
