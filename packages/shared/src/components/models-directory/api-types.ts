import { isPremiumModel } from "@/model-categories.js";

export interface ApiProvider {
	id: string;
	createdAt: string;
	name: string | null;
	description: string | null;
	streaming: boolean | null;
	cancellation: boolean | null;
	color: string | null;
	website: string | null;
	announcement: string | null;
	modelCardBadge?: string | null;
	serviceTiers?: Array<{
		id: string;
		name: string;
		multiplier: number;
		description?: string;
	}> | null;
	status: "active" | "inactive";
}

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
	inputCharacterPrice: string | null;
	outputAudioPrice: string | null;
	requestPrice: string | null;
	ocrPagePrice?: string | null;
	contextSize: number | null;
	maxOutput: number | null;
	quantization?: string | null;
	streaming: boolean;
	vision: boolean | null;
	reasoning: boolean | null;
	reasoningEfforts?:
		| ("none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max")[]
		| null;
	reasoningOutput: string | null;
	reasoningMaxTokens: boolean | null;
	tools: boolean | null;
	jsonOutput: boolean | null;
	jsonOutputSchema: boolean | null;
	webSearch: boolean | null;
	webSearchPrice: string | null;
	supportedVideoSizes: string[] | null;
	supportedVideoDurationsSeconds: number[] | null;
	supportsVideoAudio: boolean | null;
	supportsVideoWithoutAudio: boolean | null;
	perSecondPrice: Record<string, string> | null;
	pricingTiers: Array<{
		name: string;
		upToTokens: number | null;
		inputPrice: string;
		outputPrice: string;
		cachedInputPrice: string | null;
		cacheReadInputPrice: string | null;
		cacheWriteInputPrice: string | null;
		cacheWriteInputPrice1h: string | null;
	}> | null;
	serviceTiers?: string[] | null;
	discount: string | null;
	stability: "stable" | "beta" | "unstable" | "experimental" | null;
	supportedParameters: string[] | null;
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
	stability: "stable" | "beta" | "unstable" | "experimental" | null;
	status: "active" | "inactive";
	mappings: ApiModelProviderMapping[];
	/**
	 * Whether the model falls under the premium fair-use category
	 * ($5+/M input or $15+/M output). Computed server-side with the same
	 * function the gateway uses to enforce the DevPass weekly cap.
	 */
	premium: boolean;
}

type NextFetchInit = RequestInit & { next?: { revalidate?: number } };

export async function fetchModelsFromApi(
	apiBackendUrl: string,
): Promise<ApiModel[]> {
	try {
		const init: NextFetchInit = { next: { revalidate: 60 } };
		const response = await fetch(`${apiBackendUrl}/internal/models`, init);
		if (!response.ok) {
			console.error("Failed to fetch models:", response.statusText);
			return [];
		}
		const data = await response.json();
		const models: Omit<ApiModel, "premium">[] = data.models ?? [];
		return models.map((model) => ({
			...model,
			premium: isPremiumModel(model.id),
		}));
	} catch (error) {
		console.error("Error fetching models:", error);
		return [];
	}
}

export async function fetchProvidersFromApi(
	apiBackendUrl: string,
): Promise<ApiProvider[]> {
	try {
		const init: NextFetchInit = { next: { revalidate: 60 } };
		const response = await fetch(`${apiBackendUrl}/internal/providers`, init);
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
}
