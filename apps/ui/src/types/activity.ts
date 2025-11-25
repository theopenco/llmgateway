import type { Log } from "@llmgateway/db";

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
	requestCost: number;
	dataStorageCost: number;
	errorCount: number;
	errorRate: number;
	cacheCount: number;
	cacheRate: number;
	discountSavings: number;
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
				dataStorageCost: number;
				errorCount: number;
				errorRate: number;
				cacheCount: number;
				cacheRate: number;
				discountSavings: number;
				modelBreakdown: ActivityModelUsage[];
			}[];
	  }
	| undefined;

export interface LogsData {
	message?: string;
	logs: Log[];
	pagination: {
		nextCursor: string | null;
		hasMore: boolean;
		limit: number;
	};
}
