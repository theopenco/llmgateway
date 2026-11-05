import { channel } from "node:diagnostics_channel";
import { setImmediate as nextTurn } from "node:timers/promises";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { processImageUrl } from "./process-image-url.js";

import type * as Dns from "node:dns";
import type { LookupAddress } from "node:dns";
import type * as DnsPromises from "node:dns/promises";

const { preflightLookup, socketLookup } = vi.hoisted(() => ({
	preflightLookup: vi.fn(),
	socketLookup: vi.fn(),
}));
vi.mock("node:dns/promises", async (original) => ({
	...(await original<typeof DnsPromises>()),
	lookup: preflightLookup,
}));
vi.mock("node:dns", async (original) => ({
	...(await original<typeof Dns>()),
	lookup: socketLookup,
}));

type LookupCallback = (
	error: NodeJS.ErrnoException | null,
	addresses?: LookupAddress[],
) => void;
const URL = "https://image-deadline.example.com/image.png";
const headers = channel("undici:client:sendHeaders");
const sent = vi.fn();
let pending: LookupCallback | undefined;

beforeEach(() => {
	vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "false");
	vi.stubEnv("IMAGE_FETCH_TIMEOUT_MS", "100");
	preflightLookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
	sent.mockReset();
	headers.subscribe(sent);
});

afterEach(async () => {
	// Finish any OS-lookup stand-in so the native Agent cannot retain a pending dial.
	pending?.(
		Object.assign(new Error("fixture DNS closed"), { code: "ENOTFOUND" }),
	);
	pending = undefined;
	await nextTurn();
	headers.unsubscribe(sent);
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	preflightLookup.mockReset();
	socketLookup.mockReset();
});

it.each([
	[{ address: "127.0.0.1", family: 4 }],
	[
		{ address: "8.8.8.8", family: 4 },
		{ address: "10.0.0.1", family: 4 },
	],
	[{ address: "::ffff:127.0.0.1", family: 6 }],
])(
	"blocks rebinding at the real guarded socket lookup: %j",
	async (...addresses: LookupAddress[]) => {
		const rawFetch = vi.spyOn(globalThis, "fetch");
		socketLookup.mockImplementation(
			(_host, _options, callback: LookupCallback) => callback(null, addresses),
		);
		await expect(processImageUrl(URL)).rejects.toMatchObject({
			name: "RequestError",
			statusCode: 400,
			message: "Image URL is invalid or points to a disallowed host",
		});
		expect(preflightLookup).toHaveBeenCalled();
		expect(socketLookup).toHaveBeenCalled();
		expect(rawFetch).not.toHaveBeenCalled();
		expect(sent).not.toHaveBeenCalled();
	},
);

it.each(["EAI_AGAIN", "ESERVFAIL"])(
	"preserves transient preflight DNS %s",
	async (code) => {
		preflightLookup.mockRejectedValue(Object.assign(new Error(code), { code }));
		await expect(processImageUrl(URL)).rejects.toMatchObject({
			name: "HostResolutionError",
			transient: true,
		});
		expect(socketLookup).not.toHaveBeenCalled();
		expect(sent).not.toHaveBeenCalled();
	},
);

it("keeps nonexistent DNS a client error", async () => {
	preflightLookup.mockRejectedValue(
		Object.assign(new Error("missing"), { code: "ENOTFOUND" }),
	);
	await expect(processImageUrl(URL)).rejects.toMatchObject({
		name: "RequestError",
		statusCode: 400,
	});
	expect(socketLookup).not.toHaveBeenCalled();
});

it("bounds native pending socket DNS and never sends HTTP after its late callback", async () => {
	const entered = lookupEntered();
	socketLookup.mockImplementation(
		(_host, _options, callback: LookupCallback) => {
			pending = callback;
			entered.resolve();
		},
	);
	const result = processImageUrl(URL);
	const rejected = expect(result).rejects.toMatchObject({
		name: "RequestError",
		statusCode: 400,
		message: "Timed out fetching image from URL",
	});
	await entered.promise;
	await rejected;
	pending?.(null, [{ address: "127.0.0.1", family: 4 }]);
	pending = undefined;
	await nextTurn();
	expect(sent).not.toHaveBeenCalled();
});

it.each([
	new DOMException("caller deadline", "TimeoutError"),
	{ reason: "caller cancelled" },
	"caller cancelled",
])("preserves caller reason through the native Agent: %j", async (reason) => {
	const entered = lookupEntered();
	socketLookup.mockImplementation(
		(_host, _options, callback: LookupCallback) => {
			pending = callback;
			entered.resolve();
		},
	);
	const caller = new AbortController();
	const result = processImageUrl(URL, false, 20, null, caller.signal);
	const rejected = expect(result).rejects.toBe(reason);
	await entered.promise;
	caller.abort(reason);
	await rejected;
	expect(sent).not.toHaveBeenCalled();
});
function lookupEntered() {
	let resolve!: () => void;
	const promise = new Promise<void>((onResolve) => {
		resolve = onResolve;
	});
	return { promise, resolve: () => resolve() };
}
