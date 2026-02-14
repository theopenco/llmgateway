import { subDays, format } from "date-fns";

export const generateMockActivityData = () => {
	const today = new Date();
	const days = 7;
	const activity = [];

	for (let i = days - 1; i >= 0; i--) {
		const date = subDays(today, i);
		const dateStr = format(date, "yyyy-MM-dd");

		activity.push({
			date: dateStr,
			requestCount: Math.floor(Math.random() * 500) + 100,
			inputTokens: Math.floor(Math.random() * 50000) + 10000,
			outputTokens: Math.floor(Math.random() * 30000) + 5000,
			totalTokens: Math.floor(Math.random() * 80000) + 15000,
			cost: Math.random() * 5 + 0.5,
			errorCount: Math.floor(Math.random() * 10),
			cacheCount: Math.floor(Math.random() * 50) + 10,
			errorRate: Math.random() * 2,
			cacheRate: Math.random() * 20 + 5,
			modelBreakdown: [
				{
					id: "anthropic/claude-3-5-sonnet-20241022",
					requestCount: Math.floor(Math.random() * 200) + 50,
					cost: Math.random() * 2 + 0.2,
					totalTokens: Math.floor(Math.random() * 40000) + 8000,
				},
				{
					id: "openai/gpt-4o",
					requestCount: Math.floor(Math.random() * 150) + 30,
					cost: Math.random() * 1.5 + 0.1,
					totalTokens: Math.floor(Math.random() * 30000) + 5000,
				},
				{
					id: "google-ai-studio/gemini-1.5-pro",
					requestCount: Math.floor(Math.random() * 100) + 20,
					cost: Number(Math.random()) * 1 + 0.05,
					totalTokens: Math.floor(Math.random() * 20000) + 3000,
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
		projectId: "proj_demo",
		apiKeyId: "key_demo",
		organizationId: "org_demo",
		requestId: "req_abc123",
	},
	{
		id: "log-2",
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
		projectId: "proj_demo",
		apiKeyId: "key_demo",
		organizationId: "org_demo",
		requestId: "req_xyz789",
	},
	{
		id: "log-3",
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
		lastUsed: new Date(Date.now() - 1000 * 60 * 15),
	},
	{
		id: "pkey_2",
		provider: "anthropic",
		name: "Anthropic Main",
		status: "verified",
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
