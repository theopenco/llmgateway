import { subDays, format } from "date-fns";

import { randomFloatBetween, randomInt } from "@llmgateway/shared/random";

export const generateMockActivityData = () => {
	const today = new Date();
	const days = 7;
	const activity = [];

	for (let i = days - 1; i >= 0; i--) {
		const date = subDays(today, i);
		const dateStr = format(date, "yyyy-MM-dd");

		activity.push({
			date: dateStr,
			requestCount: randomInt(100, 600),
			inputTokens: randomInt(10000, 60000),
			outputTokens: randomInt(5000, 35000),
			totalTokens: randomInt(15000, 95000),
			cost: randomFloatBetween(0.5, 5.5),
			errorCount: randomInt(0, 10),
			cacheCount: randomInt(10, 60),
			errorRate: randomFloatBetween(0, 2),
			cacheRate: randomFloatBetween(5, 25),
			modelBreakdown: [
				{
					id: "anthropic/claude-3-5-sonnet-20241022",
					requestCount: randomInt(50, 250),
					cost: randomFloatBetween(0.2, 2.2),
					totalTokens: randomInt(8000, 48000),
				},
				{
					id: "openai/gpt-4o",
					requestCount: randomInt(30, 180),
					cost: randomFloatBetween(0.1, 1.6),
					totalTokens: randomInt(5000, 35000),
				},
				{
					id: "google-ai-studio/gemini-1.5-pro",
					requestCount: randomInt(20, 120),
					cost: randomFloatBetween(0.05, 1.05),
					totalTokens: randomInt(3000, 23000),
				},
			],
		});
	}

	return { activity };
};

export const mockMetrics = {
	totalRequests: "12,543",
	totalCost: "$127.43",
	avgLatency: "1.2s",
	errorRate: "0.8%",
	cacheHitRate: "23.4%",
	totalTokens: "1.2M",
};

export const mockLogs = [
	{
		id: "log-1",
		// eslint-disable-next-line no-mixed-operators
		createdAt: new Date(Date.now() - 1000 * 60 * 5),
		content:
			"LLM Gateway is a unified API for accessing multiple AI models. It provides intelligent routing, cost optimization, and comprehensive analytics.",
		unifiedFinishReason: "completed",
		usedModel: "anthropic/claude-3-5-sonnet-20241022",
		usedProvider: "anthropic",
		requestedModel: "anthropic/claude-3-5-sonnet-20241022",
		cached: false,
		totalTokens: "156",
		promptTokens: "45",
		completionTokens: "111",
		duration: 1234,
		cost: 0.00234,
		hasError: false,
		source: "docs",
		apiOrigin: "messages" as const,
		projectId: "proj_demo",
		apiKeyId: "key_demo",
		organizationId: "org_demo",
		requestId: "req_abc123",
	},
	{
		id: "log-2",
		// eslint-disable-next-line no-mixed-operators
		createdAt: new Date(Date.now() - 1000 * 60 * 15),
		content:
			"You can integrate LLM Gateway using the OpenAI SDK. Just change the base URL and API key.",
		unifiedFinishReason: "completed",
		usedModel: "openai/gpt-4o",
		usedProvider: "openai",
		requestedModel: "gpt-4o",
		cached: true,
		totalTokens: "98",
		promptTokens: "32",
		completionTokens: "66",
		cachedTokens: "32",
		duration: 234,
		cost: 0,
		hasError: false,
		source: "playground",
		apiOrigin: "chat-completions" as const,
		projectId: "proj_demo",
		apiKeyId: "key_demo",
		organizationId: "org_demo",
		requestId: "req_xyz789",
	},
	{
		id: "log-3",
		// eslint-disable-next-line no-mixed-operators
		createdAt: new Date(Date.now() - 1000 * 60 * 30),
		content: "",
		unifiedFinishReason: "error",
		usedModel: "google-ai-studio/gemini-1.5-pro",
		usedProvider: "google",
		requestedModel: "gemini-1.5-pro",
		cached: false,
		totalTokens: "23",
		promptTokens: "23",
		completionTokens: "0",
		duration: 5432,
		cost: 0,
		hasError: true,
		source: "api",
		apiOrigin: "chat-completions" as const,
		projectId: "proj_demo",
		apiKeyId: "key_demo",
		organizationId: "org_demo",
		requestId: "req_err456",
		errorDetails: {
			statusCode: 429,
			statusText: "Too Many Requests",
			responseText: "Rate limit exceeded. Please try again later.",
		},
	},
];

export const mockApiKeys = [
	{
		id: "key_1",
		name: "Production API Key",
		keyPrefix: "llmgw_prod_",
		lastFour: "a8f3",
		createdAt: new Date("2024-01-15"),
		// eslint-disable-next-line no-mixed-operators
		lastUsed: new Date(Date.now() - 1000 * 60 * 30),
		usageCount: 15432,
		status: "active",
	},
	{
		id: "key_2",
		name: "Development Key",
		keyPrefix: "llmgw_dev_",
		lastFour: "9k2m",
		createdAt: new Date("2024-02-20"),
		// eslint-disable-next-line no-mixed-operators
		lastUsed: new Date(Date.now() - 1000 * 60 * 60 * 2),
		usageCount: 2341,
		status: "active",
	},
	{
		id: "key_3",
		name: "Testing Environment",
		keyPrefix: "llmgw_test_",
		lastFour: "7p1q",
		createdAt: new Date("2024-03-10"),
		// eslint-disable-next-line no-mixed-operators
		lastUsed: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7),
		usageCount: 456,
		status: "active",
	},
];

export const mockProviderKeys = [
	{
		id: "pkey_1",
		provider: "openai",
		name: "OpenAI Production",
		status: "verified",
		// eslint-disable-next-line no-mixed-operators
		lastUsed: new Date(Date.now() - 1000 * 60 * 15),
	},
	{
		id: "pkey_2",
		provider: "anthropic",
		name: "Anthropic Main",
		status: "verified",
		// eslint-disable-next-line no-mixed-operators
		lastUsed: new Date(Date.now() - 1000 * 60 * 45),
	},
	{
		id: "pkey_3",
		provider: "google",
		name: "Google AI Studio",
		status: "pending",
		lastUsed: null,
	},
];

export const mockCostBreakdown = {
	providers: [
		{ name: "OpenAI", cost: 45.23, percentage: 35.5 },
		{ name: "Anthropic", cost: 52.18, percentage: 40.9 },
		{ name: "Google", cost: 18.45, percentage: 14.5 },
		{ name: "Together AI", cost: 11.57, percentage: 9.1 },
	],
	total: 127.43,
};

export const mockModelUsage = [
	{
		model: "anthropic/claude-3-5-sonnet-20241022",
		provider: "Anthropic",
		requests: 4532,
		tokens: 456789,
		cost: 52.18,
		avgLatency: 1123,
	},
	{
		model: "openai/gpt-4o",
		provider: "OpenAI",
		requests: 3421,
		tokens: 387654,
		cost: 45.23,
		avgLatency: 987,
	},
	{
		model: "google-ai-studio/gemini-1.5-pro",
		provider: "Google",
		requests: 1876,
		tokens: 198765,
		cost: 18.45,
		avgLatency: 1456,
	},
	{
		model: "together/mixtral-8x7b",
		provider: "Together AI",
		requests: 2134,
		tokens: 245678,
		cost: 11.57,
		avgLatency: 654,
	},
];
