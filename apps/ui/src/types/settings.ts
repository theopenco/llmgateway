import type { ProviderCacheControlMode } from "@llmgateway/models";

export interface CachingSettingsData {
	preferences: {
		organizationId: string;
		projectId: string;
		preferences: {
			cachingEnabled: boolean;
			cacheDurationSeconds: number;
			providerCacheControlMode: ProviderCacheControlMode;
			providerCacheAutoTtl: "5m" | "1h";
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
