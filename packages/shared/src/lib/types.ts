export interface ComboboxModel {
	id: string; // providerId/modelName (value sent to API)
	name?: string; // Friendly model name
	provider?: string; // Provider display name
	providerId?: string; // Provider id
	family?: string; // Model family for icon fallback
	context?: number;
	inputPrice?: string;
	outputPrice?: string;
	vision?: boolean;
	tools?: boolean;
	imageGen?: boolean;
}
