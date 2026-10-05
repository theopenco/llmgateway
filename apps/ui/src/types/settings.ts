import type { ProviderCacheControlMode } from "@llmgateway/models";

export interface CachingSettingsData {
	preferences: {
		organizationId: string;
		projectId: string;
		preferences: {
			cachingEnabled: boolean;
			cacheDurationSeconds: number;
			providerCacheControlMode: ProviderCacheControlMode;
			semanticCacheMode: "off" | "shadow" | "on";
			semanticCacheThreshold: number;
		};
	};
}

export interface ProjectModeSettingsData {
	project: {
		id: string;
		name: string;
		mode: "api-keys" | "credits" | "hybrid";
	};
}
