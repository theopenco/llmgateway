import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mockGetSignedUrl = vi.fn();
const mockFile = vi.fn(() => ({
	getSignedUrl: mockGetSignedUrl,
}));
const mockBucket = vi.fn(() => ({
	file: mockFile,
}));
const storageConstructor = vi.fn(function MockStorage() {
	return {
		bucket: mockBucket,
	};
});

vi.mock("@google-cloud/storage", () => ({
	Storage: storageConstructor,
}));

const originalGoogleCloudProject = process.env.GOOGLE_CLOUD_PROJECT;
const originalNodeEnv = process.env.NODE_ENV;

async function loadGcsModule() {
	vi.resetModules();
	return await import("./gcs.js");
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGetSignedUrl.mockResolvedValue(["https://signed.example/video.mp4"]);
	process.env.NODE_ENV = "production";
	delete process.env.GOOGLE_CLOUD_PROJECT;
});

afterEach(() => {
	if (originalGoogleCloudProject === undefined) {
		delete process.env.GOOGLE_CLOUD_PROJECT;
	} else {
		process.env.GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject;
	}

	if (originalNodeEnv === undefined) {
		delete process.env.NODE_ENV;
	} else {
		process.env.NODE_ENV = originalNodeEnv;
	}
});

describe("gcs", () => {
	test("buildGcsUri trims the bucket and normalizes the object path", async () => {
		const { buildGcsUri } = await loadGcsModule();

		expect(buildGcsUri("  bucket  ", " /nested//video.mp4 ")).toBe(
			"gs://bucket/nested/video.mp4",
		);
	});

	test("buildGcsUri rejects empty normalized paths", async () => {
		const { buildGcsUri } = await loadGcsModule();

		expect(() => buildGcsUri("bucket", " / / ")).toThrow(
			"GCS object path is required",
		);
	});

	test("uses GOOGLE_CLOUD_PROJECT for the storage client", async () => {
		process.env.GOOGLE_CLOUD_PROJECT = "runtime-project";
		const { createSignedGcsReadUrl } = await loadGcsModule();

		const signedUrl = await createSignedGcsReadUrl(
			"gs://bucket/path/video.mp4",
		);

		expect(signedUrl).toBe("https://signed.example/video.mp4");
		expect(storageConstructor).toHaveBeenCalledWith({
			projectId: "runtime-project",
		});
	});

	test("does not override the storage project when GOOGLE_CLOUD_PROJECT is unset", async () => {
		const { createSignedGcsReadUrl } = await loadGcsModule();

		const signedUrl = await createSignedGcsReadUrl(
			"gs://bucket/path/video.mp4",
		);

		expect(signedUrl).toBe("https://signed.example/video.mp4");
		expect(storageConstructor).toHaveBeenCalledWith();
	});
});
