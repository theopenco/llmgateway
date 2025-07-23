export interface ActivityModelUsage {
	id: string;
	provider: string;
	requestCount: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	cost: number;
}

export interface DailyActivity {
	date: string;
	requestCount: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	cost: number;
	outputCost: number;
	inputCost: number;
	errorCount: number;
	errorRate: number;
	cacheCount: number;
	cacheRate: number;
	modelBreakdown: ActivityModelUsage[];
}

export interface ActivityResponse {
	activity: DailyActivity[];
}

export type ActivitT =
	| {
			activity: {
				date: string;
				requestCount: number;
				inputTokens: number;
				outputTokens: number;
				totalTokens: number;
				cost: number;
				inputCost: number;
				outputCost: number;
				requestCost: number;
				errorCount: number;
				errorRate: number;
				cacheCount: number;
				cacheRate: number;
				modelBreakdown: {
					id: string;
					provider: string;
					requestCount: number;
					inputTokens: number;
					outputTokens: number;
					totalTokens: number;
					cost: number;
				}[];
			}[];
	  }
	| undefined;

export interface LogsData {
	message?: string;
	logs: {
		id: string;
		requestId: string;
		createdAt: string;
		updatedAt: string;
		organizationId: string;
		projectId: string;
		apiKeyId: string;
		duration: number;
		requestedModel: string;
		requestedProvider: string | null;
		usedModel: string;
		usedProvider: string;
		responseSize: number;
		content: string | null;
		reasoningContent: string | null;
		unifiedFinishReason: string | null;
		finishReason: string | null;
		promptTokens: string | null;
		completionTokens: string | null;
		cachedTokens: string | null;
		totalTokens: string | null;
		reasoningTokens: string | null;
		messages?: unknown;
		temperature: number | null;
		maxTokens: number | null;
		topP: number | null;
		frequencyPenalty: number | null;
		presencePenalty: number | null;
		hasError: boolean | null;
		errorDetails: {
			statusCode: number;
			statusText: string;
			responseText: string;
		} | null;
		cost: number | null;
		cachedInputCost: number | null;
		inputCost: number | null;
		outputCost: number | null;
		requestCost: number | null;
		estimatedCost: boolean | null;
		canceled: boolean | null;
		streamed: boolean | null;
		cached: boolean | null;
		mode: "api-keys" | "credits" | "hybrid";
		usedMode: "api-keys" | "credits";
	}[];
	pagination: {
		nextCursor: string | null;
		hasMore: boolean;
		limit: number;
	};
}
