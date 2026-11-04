import { afterEach, describe, expect, it, vi } from "vitest";

import { modelFamilyLabel } from "./model-family.js";
import { models } from "./models.js";
import {
	getProviderEnvKeys,
	getProviderEnvValue,
	getProviderEnvVar,
} from "./provider.js";
import { getProviderDefinition } from "./providers.js";

import type { ModelDefinition } from "./models.js";

afterEach(() => vi.unstubAllEnvs());

describe("fal FLUX 3 Max", () => {
	it("discovers the exact API key and optional base URL for provider credentials", () => {
		expect(getProviderDefinition("fal-ai")).toMatchObject({
			name: "fal",
			dataPolicy: null,
		});
		expect(getProviderEnvVar("fal-ai")).toBe("LLM_FAL_AI_API_KEY");
		expect(getProviderEnvKeys("fal-ai")).toEqual([
			{ key: "apiKey", envVar: "LLM_FAL_AI_API_KEY", required: true },
			{ key: "baseUrl", envVar: "LLM_FAL_AI_BASE_URL", required: false },
		]);
		vi.stubEnv("LLM_FAL_AI_API_KEY", "test-token");
		expect(getProviderEnvValue("fal-ai", "apiKey") === "test-token").toBe(true);
	});

	it("defines one canonical video-only model, not upstream mode aliases", () => {
		const matches = models.filter((model) => model.id.startsWith("flux-3-max"));
		expect(matches).toHaveLength(1);
		const model: ModelDefinition = matches[0];
		expect(model).toMatchObject({
			id: "flux-3-max",
			family: "black-forest-labs",
			output: ["video"],
			maxVideoDurationSeconds: 20,
			releasedAt: new Date("2026-10-15"),
		});
		expect(modelFamilyLabel(model.family)).toBe("Black Forest Labs");
		expect(model.providers).toHaveLength(1);
		const mapping = model.providers[0];
		expect(mapping).toMatchObject({
			providerId: "fal-ai",
			externalId: "blackforestlabs/flux-3-max",
			streaming: false,
			vision: true,
			videoGenerations: true,
			supportedVideoSizes: ["1280x720", "720x1280", "1920x1080", "1080x1920"],
			supportsVideoAudio: true,
			supportsVideoWithoutAudio: true,
		});
		const durations = Array.from({ length: 16 }, (_, index) => index + 5);
		expect(mapping.supportedVideoDurationsSeconds).toEqual(durations);
		expect(mapping.supportedVideoDurationsSecondsImageToVideo).toEqual(
			durations,
		);
		expect(mapping.reasoningEfforts).toBeUndefined();
		expect(mapping.imageGenerations).toBeUndefined();
		expect(mapping.perSecondPrice).toEqual({
			default_audio: "0.17",
			default_video: "0.17",
			"720p_audio": "0.17",
			"720p_video": "0.17",
			"1080p_audio": "0.29",
			"1080p_video": "0.29",
		});
	});
});
