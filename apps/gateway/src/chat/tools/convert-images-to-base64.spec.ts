import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	convertImagesToBase64,
	resolveImageFetchTimeoutMs,
} from "./convert-images-to-base64.js";

function image(url: string) {
	return { type: "image_url" as const, image_url: { url } };
}

describe("convertImagesToBase64 URL safety", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	it.each([
		"http://cdn.example.com/image.png",
		"https://127.0.0.1/image.png",
		"https://169.254.169.254/latest/meta-data",
		"https://10.0.0.1/image.png",
		"https://metadata.google.internal/image.png",
	])("does not fetch an unsafe provider image URL: %s", async (url) => {
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "false");
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const input = image(url);

		await expect(convertImagesToBase64([input])).resolves.toEqual([input]);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("refuses redirects when fetching a provider image", async () => {
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "true");
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(new Uint8Array([1, 2, 3]), {
				headers: { "content-type": "image/png" },
			}),
		);

		const result = await convertImagesToBase64([
			image("https://cdn.example.com/image.png"),
		]);

		expect(fetchSpy).toHaveBeenCalledWith("https://cdn.example.com/image.png", {
			redirect: "error",
			signal: expect.any(AbortSignal),
		});
		expect(result[0]?.image_url.url).toBe("data:image/png;base64,AQID");
	});

	it("bounds the image fetch with an abort signal and falls back when it aborts", async () => {
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "true");
		// Simulate the fetch deadline firing: reject as AbortSignal.timeout would.
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation((_url, init) => {
				expect(init?.signal).toBeInstanceOf(AbortSignal);
				return Promise.reject(
					Object.assign(new Error("The operation was aborted"), {
						name: "TimeoutError",
					}),
				);
			});

		const input = image("https://cdn.example.com/slow.png");
		// Must resolve (fall back to the original image), never hang.
		await expect(convertImagesToBase64([input])).resolves.toEqual([input]);
		expect(fetchSpy).toHaveBeenCalled();
		expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
	});

	it("gives up on a host that never finishes sending the image", async () => {
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "true");
		vi.stubEnv("IMAGE_FETCH_TIMEOUT_MS", "50");
		// Models undici: the response body stream is errored when the fetch signal
		// aborts mid-download. bodyTimeout is refreshed on every chunk, so only the
		// signal bounds a host that answers and then trickles nothing.
		vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
			const signal = init?.signal;
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					signal?.addEventListener("abort", () => {
						controller.error(signal.reason);
					});
				},
				pull() {
					return new Promise<void>(() => {});
				},
			});
			return Promise.resolve(
				new Response(body, { headers: { "content-type": "image/png" } }),
			);
		});

		const input = image("https://cdn.example.com/trickle.png");
		// Falls back to the original image instead of hanging on arrayBuffer().
		await expect(convertImagesToBase64([input])).resolves.toEqual([input]);
	});
});

describe("resolveImageFetchTimeoutMs", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("defaults to 15000 when unset", () => {
		delete process.env.IMAGE_FETCH_TIMEOUT_MS;
		expect(resolveImageFetchTimeoutMs()).toBe(15_000);
	});

	it.each(["0", "-1", "Infinity", "1.5", "not-a-number", "", "   "])(
		"falls back to 15000 for invalid value %s (never throws)",
		(value) => {
			vi.stubEnv("IMAGE_FETCH_TIMEOUT_MS", value);
			expect(resolveImageFetchTimeoutMs()).toBe(15_000);
			expect(() =>
				AbortSignal.timeout(resolveImageFetchTimeoutMs()),
			).not.toThrow();
		},
	);

	it("honours a valid integer value", () => {
		vi.stubEnv("IMAGE_FETCH_TIMEOUT_MS", "5000");
		expect(resolveImageFetchTimeoutMs()).toBe(5000);
	});

	it("rejects 0 rather than aborting every fetch", () => {
		vi.stubEnv("IMAGE_FETCH_TIMEOUT_MS", "0");
		expect(resolveImageFetchTimeoutMs()).toBe(15_000);
	});
});

describe("convertImagesToBase64 network deadline", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it.each(["headers", "body"])(
		"bounds a stalled %s over HTTP",
		async (stage) => {
			vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "true");
			vi.stubEnv("IMAGE_FETCH_TIMEOUT_MS", "250");
			let attempts = 0;
			const server = createServer((_request, response) => {
				attempts++;
				if (stage === "body") {
					response.writeHead(200, { "content-type": "image/png" });
					response.write(new Uint8Array([1]));
				}
			});
			server.listen(0, "127.0.0.1");
			await once(server, "listening");
			try {
				const address = server.address();
				if (!address || typeof address === "string") {
					throw new Error("Expected a TCP listener");
				}
				const input = image(`http://127.0.0.1:${address.port}/image.png`);
				await expect(convertImagesToBase64([input])).resolves.toEqual([input]);
				expect(attempts).toBe(3);
			} finally {
				server.closeAllConnections();
				await new Promise<void>((resolve, reject) => {
					server.close((error) => (error ? reject(error) : resolve()));
				});
			}
		},
		5000,
	);
});

it.each(["headers", "body"])(
	"retains the %s deadline during garbage collection",
	async (stage) => {
		const source = new URL("./convert-images-to-base64.ts", import.meta.url)
			.href;
		const program = `
		(async () => {
		const { default: assert } = await import("node:assert/strict");
		const { once } = await import("node:events");
		const { createServer } = await import("node:http");
		const { convertImagesToBase64 } = await import(${JSON.stringify(source)});
		process.env.ALLOW_INSECURE_PROVIDER_URLS = "true";
		process.env.IMAGE_FETCH_TIMEOUT_MS = "250";
		let attempts = 0;
		let fetches = 0;
		const nativeFetch = globalThis.fetch;
		globalThis.fetch = (...args) => {
			fetches++;
			return nativeFetch(...args);
		};
		const downloadsClosed = [];
		const server = createServer((_request, response) => {
			attempts++;
			downloadsClosed.push(new Promise((resolve) => response.once("close", resolve)));
			if (${JSON.stringify(stage)} === "body") {
				response.writeHead(200, { "content-type": "image/png" });
				response.write(new Uint8Array([1]));
			}
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const gc = setInterval(() => global.gc(), 20);
		const watchdog = setTimeout(() => {
			console.error("Download deadline lost during garbage collection");
			process.exit(1);
		}, 8000);
		try {
			const input = { type: "image_url", image_url: { url: "http://127.0.0.1:" + server.address().port + "/image.png" } };
			assert.deepEqual(await convertImagesToBase64([input]), [input]);
			assert.equal(fetches, 3);
			assert.ok(attempts > 0 && attempts <= fetches);
			await Promise.all(downloadsClosed);
		} finally {
			clearInterval(gc);
			clearTimeout(watchdog);
			await new Promise((resolve, reject) => {
				server.close((error) => error ? reject(error) : resolve());
				server.closeAllConnections();
			});
		}
		})().catch((error) => {
			console.error(error);
			process.exitCode = 1;
		});
	`;
		// Allow loader startup separately from the child's deadline watchdog.
		await promisify(execFile)(
			process.execPath,
			["--expose-gc", "--import", "tsx", "-e", program],
			{
				timeout: 30000,
				env: {
					...process.env,
					TSX_TSCONFIG_PATH: fileURLToPath(
						new URL("../../../tsconfig.json", import.meta.url),
					),
				},
			},
		);
	},
	35000,
);

it("clears the deadline timer after a successful download", async () => {
	vi.useFakeTimers();
	vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "true");
	let signal: AbortSignal | null | undefined;
	vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
		signal = init?.signal;
		return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
	});
	try {
		const result = await convertImagesToBase64([
			image("https://cdn.example.com/image.png"),
		]);
		expect(result[0]?.image_url.url).toBe("data:image/png;base64,AQID");
		expect(signal?.aborted).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	} finally {
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	}
});

it("cancels rejected response bodies and clears their deadline", async () => {
	vi.useFakeTimers();
	vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "true");
	const cancel = vi.fn();
	const schedule = vi.spyOn(globalThis, "setTimeout");
	const clear = vi.spyOn(globalThis, "clearTimeout");
	vi.stubEnv("IMAGE_FETCH_TIMEOUT_MS", "15000");
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		new Response(new ReadableStream({ cancel }), { status: 403 }),
	);
	try {
		const input = image("https://cdn.example.com/forbidden.png");
		await expect(convertImagesToBase64([input])).resolves.toEqual([input]);
		expect(cancel).toHaveBeenCalledOnce();
		const deadline = schedule.mock.calls.findIndex(([, ms]) => ms === 15_000);
		expect(deadline).toBeGreaterThanOrEqual(0);
		expect(clear).toHaveBeenCalledWith(schedule.mock.results[deadline]?.value);
	} finally {
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	}
});

it("cancels a response body when the deadline fires before headers resolve", async () => {
	vi.useFakeTimers();
	vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "true");
	vi.stubEnv("IMAGE_FETCH_TIMEOUT_MS", "250");
	const cancel = vi.fn();
	vi.spyOn(globalThis, "fetch").mockImplementation(
		(_url, init) =>
			new Promise((resolve) => {
				init?.signal?.addEventListener(
					"abort",
					() => {
						resolve(new Response(new ReadableStream({ cancel })));
					},
					{ once: true },
				);
			}),
	);
	try {
		const input = image("https://cdn.example.com/late-headers.png");
		const result = convertImagesToBase64([input]);
		await vi.runAllTimersAsync();
		await expect(result).resolves.toEqual([input]);
		expect(cancel).toHaveBeenCalledTimes(3);
	} finally {
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	}
});
