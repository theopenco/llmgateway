export interface CachingSettingsData {
	preferences: {
		organizationId: string;
		projectId: string;
		preferences: {
			cachingEnabled: boolean;
			cacheDurationSeconds: number;
			providerCacheControlMode: "auto" | "passthrough" | "off";
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
