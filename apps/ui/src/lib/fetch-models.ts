import { cache } from "react";

import { getConfig } from "./config-server";

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
	status: "active" | "inactive";
}

export interface ApiModelProviderMapping {
	id: string;
	createdAt: string;
	modelId: string;
	providerId: string;
	modelName: string;
	inputPrice: string | null;
	outputPrice: string | null;
	cachedInputPrice: string | null;
	imageInputPrice: string | null;
	requestPrice: string | null;
	contextSize: number | null;
	maxOutput: number | null;
	streaming: boolean;
	vision: boolean | null;
	reasoning: boolean | null;
	reasoningOutput: string | null;
	reasoningMaxTokens: boolean | null;
	tools: boolean | null;
	jsonOutput: boolean | null;
	jsonOutputSchema: boolean | null;
	webSearch: boolean | null;
	webSearchPrice: string | null;
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
}

export const fetchModels = cache(async (): Promise<ApiModel[]> => {
	const config = getConfig();
	try {
		const response = await fetch(`${config.apiBackendUrl}/internal/models`, {
			next: { revalidate: 60 },
		});
		if (!response.ok) {
			console.error("Failed to fetch models:", response.statusText);
			return [];
		}
		const data = await response.json();
		return data.models || [];
	} catch (error) {
		console.error("Error fetching models:", error);
		return [];
	}
});

export const fetchProviders = cache(async (): Promise<ApiProvider[]> => {
	const config = getConfig();
	try {
		const response = await fetch(`${config.apiBackendUrl}/internal/providers`, {
			next: { revalidate: 60 },
		});
		if (!response.ok) {
			console.error("Failed to fetch providers:", response.statusText);
			return [];
		}
		const data = await response.json();
		return data.providers || [];
	} catch (error) {
		console.error("Error fetching providers:", error);
		return [];
	}
});
