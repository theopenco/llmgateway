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
	/** Branding uploaded by the Airside carrier that claimed this provider. */
	airsideLogoUrl?: string | null;
	airsideIconUrl?: string | null;
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
	inputAudioPrice?: string | null;
	cachedInputAudioPrice?: string | null;
	outputAudioPrice: string | null;
	requestPrice: string | null;
	ocrPagePrice?: string | null;
	inputAudioHourPrice?: string | null;
	contextSize: number | null;
	maxOutput: number | null;
	quantization?: string | null;
	streaming: boolean;
	vision: boolean | null;
	audio?: boolean | null;
	document?: boolean | null;
	reasoning: boolean | null;
	reasoningEfforts?:
		("none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max")[] | null;
	reasoningOutput: string | null;
	reasoningMaxTokens: boolean | null;
	rerank: boolean | null;
	tools: boolean | null;
	jsonOutput: boolean | null;
	jsonOutputSchema: boolean | null;
	webSearch: boolean | null;
	webSearchPrice: string | null;
	realtime?: boolean | null;
	supportedVoices?: string[] | null;
	supportedVideoSizes: string[] | null;
	supportedVideoDurationsSeconds: number[] | null;
	supportedVideoDurationsSecondsImageToVideo?: number[] | null;
	supportsVideoAudio: boolean | null;
	supportsVideoWithoutAudio: boolean | null;
	perSecondPrice: Record<string, string> | null;
	perImagePrice: Record<string, string> | null;
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
	peakPricing?: {
		peak: {
			inputPrice: string;
			outputPrice: string;
			cachedInputPrice: string | null;
		};
		offPeak: {
			inputPrice: string;
			outputPrice: string;
			cachedInputPrice: string | null;
		};
		hoursUtc: Array<[number, number]>;
		offPeakDays: {
			daysOfWeek: number[];
			utcOffsetMinutes: number;
			timeZoneLabel: string;
		} | null;
	} | null;
	serviceTiers?: string[] | null;
	discount: string | null;
	stability: "stable" | "beta" | "unstable" | "experimental" | null;
	supportedParameters: string[] | null;
	deprecatedAt: string | null;
	deactivatedAt: string | null;
	status: "active" | "inactive";
	/**
	 * Org directory only: human-readable reasons this mapping is not routable
	 * under the viewing organization's provider compliance policy. Absent or
	 * empty on public surfaces and for eligible mappings.
	 */
	blockedReasons?: string[];
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
	imageInputRequired?: boolean | null;
	stability: "stable" | "beta" | "unstable" | "experimental" | null;
	status: "active" | "inactive";
	mappings: ApiModelProviderMapping[];
	/**
	 * Whether the model falls under the premium fair-use category
	 * ($5+/M input or $15+/M output). Computed server-side with the same
	 * function the gateway uses to enforce the DevPass weekly cap.
	 */
	premium: boolean;
	/**
	 * Org directory only: distinguishes catalogue models from models defined in
	 * the organization's own custom-model catalog. Absent on public surfaces
	 * (treated as "catalog").
	 */
	source?: "catalog" | "custom";
}

type NextFetchInit = RequestInit & { next?: { revalidate?: number } };

// Deliberate module-level cache (per server process, keyed by backend URL):
// the models payload exceeds Next's 2MB fetch-cache entry limit, so `next:
// { revalidate }` can never refresh it — a stale disk entry would be served
// forever. This memo restores the 60s reuse and keeps serving the last good
// catalogue through an API blip instead of rendering an empty directory.
const MODELS_MEMO_TTL_MS = 60_000;
const modelsMemo = new Map<string, { data: ApiModel[]; fetchedAt: number }>();

export function fetchModelsResponseFromApi(
	apiBackendUrl: string,
): Promise<Response> {
	return fetch(`${apiBackendUrl}/internal/models`, { cache: "no-store" });
}

export async function fetchModelsFromApi(
	apiBackendUrl: string,
): Promise<ApiModel[]> {
	const memo = modelsMemo.get(apiBackendUrl);
	if (memo && Date.now() - memo.fetchedAt < MODELS_MEMO_TTL_MS) {
		return memo.data;
	}
	try {
		const response = await fetchModelsResponseFromApi(apiBackendUrl);
		if (!response.ok) {
			console.error("Failed to fetch models:", response.statusText);
			return memo?.data ?? [];
		}
		const data = await response.json();
		const models: Omit<ApiModel, "premium">[] = data.models ?? [];
		const withPremium = models.map((model) => ({
			...model,
			premium: isPremiumModel(model.id),
		}));
		modelsMemo.set(apiBackendUrl, {
			data: withPremium,
			fetchedAt: Date.now(),
		});
		return withPremium;
	} catch (error) {
		console.error("Error fetching models:", error);
		return memo?.data ?? [];
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
