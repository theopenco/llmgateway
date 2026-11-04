import { cache } from "react";

import { fetchModelsResponseFromApi } from "@llmgateway/shared/components";

export interface ApiProvider {
	id: string;
	createdAt: string;
	name: string | null;
	description: string | null;
	cancellation: boolean | null;
	color: string | null;
	website: string | null;
	announcement: string | null;
	status: "active" | "inactive";
}

export type ReasoningEffortOption =
	"none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ApiModelProviderMapping {
	id: string;
	createdAt: string;
	modelId: string;
	providerId: string;
	externalId: string;
	region?: string | null;
	inputPrice: string | null;
	outputPrice: string | null;
	cachedInputPrice: string | null;
	cacheWriteInputPrice: string | null;
	cacheWriteInputPrice1h: string | null;
	imageInputPrice: string | null;
	imageOutputPrice: string | null;
	imageInputTokensByResolution: Record<string, number> | null;
	imageOutputTokensByResolution: Record<string, number> | null;
	// Audio token prices. These, not the text prices, are what a voice session
	// actually spends most of its tokens on.
	inputAudioPrice: string | null;
	cachedInputAudioPrice: string | null;
	outputAudioPrice: string | null;
	requestPrice: string | null;
	inputAudioHourPrice: string | null;
	contextSize: number | null;
	maxOutput: number | null;
	streaming: boolean;
	vision: boolean | null;
	audio: boolean | null;
	document: boolean | null;
	reasoning: boolean | null;
	reasoningEfforts: ReasoningEffortOption[] | null;
	reasoningOutput: string | null;
	tools: boolean | null;
	jsonOutput: boolean | null;
	jsonOutputSchema: boolean | null;
	webSearch: boolean | null;
	realtime: boolean | null;
	realtimeTranscription: boolean | null;
	realtimeTranscriptionTurnDetection: boolean | null;
	supportedVoices: string[] | null;
	discount: string | null;
	stability: "stable" | "beta" | "unstable" | "experimental" | null;
	supportedParameters: string[] | null;
	supportedVideoSizes: string[] | null;
	supportedVideoDurationsSeconds: number[] | null;
	supportedVideoDurationsSecondsImageToVideo: number[] | null;
	supportsVideoAudio: boolean | null;
	supportsVideoWithoutAudio: boolean | null;
	perSecondPrice: Record<string, string> | null;
	perImagePrice: Record<string, string> | null;
	serviceTiers?: string[] | null;
	deprecatedAt: string | null;
	deactivatedAt: string | null;
	status: "active" | "inactive";
}

export interface ApiModel {
	id: string;
	createdAt: string;
	releasedAt: string | null;
	name: string | null;
	aliases: string[] | null;
	description: string | null;
	family: string;
	free: boolean | null;
	output: string[] | null;
	imageInputRequired: boolean | null;
	stability: "stable" | "beta" | "unstable" | "experimental" | null;
	status: "active" | "inactive";
	mappings: ApiModelProviderMapping[];
}

const API_URL =
	process.env.API_BACKEND_URL ?? process.env.API_URL ?? "http://localhost:4002";

// Deliberate module-level cache, same rationale as fetchModelsFromApi in
// @llmgateway/shared: the models payload exceeds Next's 2MB fetch-cache entry
// limit, so `next: { revalidate }` can never refresh it. This memo gives the
// catalogue 60s cross-request reuse and keeps serving the last good data
// through an API blip. React's cache() stays as the per-request dedup layer.
const MODELS_MEMO_TTL_MS = 60_000;
let modelsMemo: { data: ApiModel[]; fetchedAt: number } | null = null;

export const fetchModels = cache(async (): Promise<ApiModel[]> => {
	if (modelsMemo && Date.now() - modelsMemo.fetchedAt < MODELS_MEMO_TTL_MS) {
		return modelsMemo.data;
	}
	try {
		const response = await fetchModelsResponseFromApi(API_URL);
		if (!response.ok) {
			console.error("Failed to fetch models:", response.statusText);
			return modelsMemo?.data ?? [];
		}
		const data = await response.json();
		const models = (data.models ?? []) as ApiModel[];
		modelsMemo = { data: models, fetchedAt: Date.now() };
		return models;
	} catch (error) {
		console.error("Error fetching models:", error);
		return modelsMemo?.data ?? [];
	}
});

export const fetchProviders = cache(async (): Promise<ApiProvider[]> => {
	try {
		// Small payload, so Next's data cache can hold it; 60s matches the
		// shared fetchProvidersFromApi helper.
		const response = await fetch(`${API_URL}/internal/providers`, {
			next: { revalidate: 60 },
		});
		if (!response.ok) {
			console.error("Failed to fetch providers:", response.statusText);
			return [];
		}
		const data = await response.json();
		return data.providers ?? [];
	} catch (error) {
		console.error("Error fetching providers:", error);
		return [];
	}
});
