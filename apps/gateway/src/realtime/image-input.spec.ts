import { afterEach, describe, expect, it, vi } from "vitest";

import { processImageUrl } from "@llmgateway/actions";

import { prepareRealtimeImageInput } from "./image-input.js";
import { supportsRealtimeImageInput } from "./pricing.js";

import type { ProviderModelMapping } from "@llmgateway/models";

vi.mock("@llmgateway/actions", () => ({ processImageUrl: vi.fn() }));

const mapping: ProviderModelMapping = {
	providerId: "azure",
	externalId: "gpt-realtime-2.1-mini",
	streaming: true,
	realtime: true,
	vision: true,
	imageInputPrice: "0.8e-6",
	cachedImageInputPrice: "0.08e-6",
};
const remoteUrl = "https://example.com/image.png";
const imageResult = { mimeType: "image/png", data: "aW1hZ2U=" };

function imageInput(url: string) {
	return [
		{
			type: "message",
			role: "user",
			content: [{ type: "input_image", image_url: url }],
		},
	];
}

function deferredImage() {
	let resolve!: (value: typeof imageResult) => void;
	const promise = new Promise<typeof imageResult>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function cleanup() {
	vi.resetAllMocks();
	vi.unstubAllEnvs();
	vi.useRealTimers();
}

async function downloadsGuardedImage() {
	vi.mocked(processImageUrl).mockResolvedValue(imageResult);
	const input = imageInput(remoteUrl);
	expect(
		await prepareRealtimeImageInput(
			input,
			mapping,
			new AbortController().signal,
		),
	).toBeNull();
	expect(processImageUrl).toHaveBeenCalledWith(
		remoteUrl,
		false,
		10,
		null,
		expect.any(AbortSignal),
	);
	expect(input[0]?.content[0]?.image_url).toBe(
		"data:image/png;base64,aW1hZ2U=",
	);
}

async function rejectsUnsafeSyntax(url: string) {
	expect(
		await prepareRealtimeImageInput(
			imageInput(url),
			mapping,
			new AbortController().signal,
		),
	).toMatchObject({ code: "invalid_image_url" });
	expect(processImageUrl).not.toHaveBeenCalled();
}

async function rejectsUnbillableMapping(
	overrides: Partial<ProviderModelMapping>,
) {
	const unbillable = { ...mapping, ...overrides };
	expect(supportsRealtimeImageInput(unbillable)).toBe(false);
	expect(
		await prepareRealtimeImageInput(
			imageInput(remoteUrl),
			unbillable,
			new AbortController().signal,
		),
	).toMatchObject({ code: "image_input_not_supported" });
	expect(processImageUrl).not.toHaveBeenCalled();
}

async function sanitizesDownloadErrors() {
	vi.mocked(processImageUrl).mockRejectedValue(
		new Error("private address or credentials"),
	);
	const input = imageInput(remoteUrl);
	const result = await prepareRealtimeImageInput(
		input,
		mapping,
		new AbortController().signal,
	);
	expect(result).toMatchObject({ code: "invalid_image_url" });
	expect(result?.message).not.toContain("private address or credentials");
	expect(input[0]?.content[0]?.image_url).toBe(remoteUrl);
}

async function rejectsDownloadedMediaType() {
	vi.mocked(processImageUrl).mockResolvedValue({
		mimeType: "image/svg+xml",
		data: "aW1hZ2U=",
	});
	expect(
		await prepareRealtimeImageInput(
			imageInput(remoteUrl),
			mapping,
			new AbortController().signal,
		),
	).toMatchObject({ code: "invalid_image_url" });
}

async function timesOutBeforeValidation() {
	vi.useFakeTimers();
	vi.stubEnv("IMAGE_FETCH_TIMEOUT_MS", "10");
	const pending = deferredImage();
	vi.mocked(processImageUrl).mockReturnValue(pending.promise);
	const input = imageInput(remoteUrl);
	const result = prepareRealtimeImageInput(
		input,
		mapping,
		new AbortController().signal,
	);
	global.gc?.();
	await vi.advanceTimersByTimeAsync(10);
	expect(await result).toMatchObject({ code: "invalid_image_url" });
	expect(vi.mocked(processImageUrl).mock.calls[0]?.[4]?.aborted).toBe(true);
	pending.resolve(imageResult);
	await Promise.resolve();
	expect(input[0]?.content[0]?.image_url).toBe(remoteUrl);
}

async function abortsOnClose() {
	const pending = deferredImage();
	vi.mocked(processImageUrl).mockReturnValue(pending.promise);
	const controller = new AbortController();
	const input = imageInput(remoteUrl);
	const result = prepareRealtimeImageInput(input, mapping, controller.signal);
	global.gc?.();
	controller.abort();
	expect(await result).toMatchObject({ code: "invalid_image_url" });
	pending.resolve(imageResult);
	await Promise.resolve();
	expect(input[0]?.content[0]?.image_url).toBe(remoteUrl);
}

afterEach(cleanup);
describe("realtime image input", () => {
	it(
		"downloads HTTPS images with the shared URL guard and only forwards inline data",
		downloadsGuardedImage,
	);
	it.each([
		"http://example.com/image.png",
		"file:///image.png",
		"data:image/svg+xml;base64,aW1hZ2U=",
		"data:image/png;base64,",
	])("rejects unsafe syntax %s before downloads", rejectsUnsafeSyntax);
	it.each([
		{ vision: false },
		{ imageInputPrice: undefined },
		{ cachedImageInputPrice: undefined },
		{ imageInputPrice: "NaN" },
		{ cachedImageInputPrice: "Infinity" },
		{ imageInputPrice: "-1" },
		{ imageInputPrice: "" },
		{ requestPrice: "1" },
		{ realtime: false },
	])("refuses unbillable mappings %j", rejectsUnbillableMapping);
	it("keeps valid zero image rates", () => {
		expect(
			supportsRealtimeImageInput({
				...mapping,
				imageInputPrice: "0",
				cachedImageInputPrice: "0",
			}),
		).toBe(true);
	});
	it(
		"sanitizes download failures without forwarding remote URLs",
		sanitizesDownloadErrors,
	);
	it("rejects unsupported downloaded media types", rejectsDownloadedMediaType);
	it(
		"starts its deadline before URL validation and ignores late downloads",
		timesOutBeforeValidation,
	);
	it(
		"cancels outstanding downloads on session close even after forced GC",
		abortsOnClose,
	);
});
async function acceptsParameterizedMediaType() {
	vi.mocked(processImageUrl).mockResolvedValue({
		mimeType: "IMAGE/PNG; charset=binary",
		data: imageResult.data,
	});
	const input = imageInput(remoteUrl);
	expect(
		await prepareRealtimeImageInput(
			input,
			mapping,
			new AbortController().signal,
		),
	).toBeNull();
	expect(input[0]?.content[0]?.image_url).toBe(
		"data:image/png;base64,aW1hZ2U=",
	);
}
async function limitsAggregateImageSize() {
	const data = Buffer.alloc(6 * 1024 * 1024).toString("base64");
	vi.mocked(processImageUrl).mockResolvedValue({ mimeType: "image/png", data });
	const input = [...imageInput(remoteUrl), ...imageInput(remoteUrl)];
	expect(
		await prepareRealtimeImageInput(
			input,
			mapping,
			new AbortController().signal,
		),
	).toMatchObject({ code: "invalid_image_url" });
	expect(vi.mocked(processImageUrl).mock.calls[1]?.[2]).toBe(4);
}

it(
	"normalizes downloaded image Content-Type parameters",
	acceptsParameterizedMediaType,
);
it("caps the aggregate image bytes in an event", limitsAggregateImageSize);
