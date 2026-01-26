import type { ReactNode } from "react";

export interface FeatureDefinition {
	id: string;
	slug: string;
	title: string;
	subtitle: string;
	description: string;
	longDescription: string;
	icon: ReactNode;
	benefits: Array<{
		title: string;
		description: string;
	}>;
	useCases: Array<{
		title: string;
		description: string;
	}>;
	codeExample?: {
		title: string;
		language: string;
		code: string;
	};
	demoComponent?:
		| "multi-provider"
		| "performance-monitoring"
		| "api-key"
		| "cost-analytics"
		| "model-breakdown"
		| "errors-monitoring"
		| "activity-logs"
		| "audit-logs"
		| "guardrails";
}

export const features: FeatureDefinition[] = [
	{
		id: "unified-api",
		slug: "unified-api-interface",
		title: "Unified API Interface",
		subtitle: "One API for all LLM providers",
		description:
			"Compatible with the OpenAI API format for seamless migration and integration.",
		longDescription:
			"LLM Gateway provides a unified API interface that's fully compatible with the OpenAI API format. This means you can easily migrate from OpenAI to any other provider without changing your code. Simply update the base URL and API key, and you're ready to go.",
		icon: null,
		benefits: [
			{
				title: "Zero Code Changes",
				description:
					"Switch between providers without modifying your application code",
			},
			{
				title: "Standard Format",
				description:
					"Use the familiar OpenAI SDK and API format across all providers",
			},
			{
				title: "Fast Migration",
				description:
					"Migrate from OpenAI to other providers in minutes, not days",
			},
			{
				title: "Future-Proof",
				description:
					"Add new providers as they become available without code changes",
			},
		],
		useCases: [
			{
				title: "Multi-Provider Applications",
				description:
					"Build applications that can use different providers for different use cases",
			},
			{
				title: "Cost Optimization",
				description: "Switch to cheaper providers for less critical workloads",
			},
			{
				title: "Risk Mitigation",
				description: "Avoid vendor lock-in by using a provider-agnostic API",
			},
		],
		codeExample: {
			title: "Simple Integration",
			language: "typescript",
			code: `import OpenAI from "openai";

const client = new OpenAI({
	baseURL: "https://api.llmgateway.io/v1",
	apiKey: process.env.LLMGATEWAY_API_KEY,
});

const completion = await client.chat.completions.create({
	model: "anthropic/claude-3-5-sonnet-20241022",
	messages: [
		{ role: "user", content: "Hello, how are you?" }
	],
});

console.log(completion.choices[0].message.content);`,
		},
	},
	{
		id: "multi-provider",
		slug: "multi-provider-support",
		title: "Multi-Provider Support",
		subtitle: "Access 19+ LLM providers through one gateway",
		description: "Connect to various LLM providers through a single gateway.",
		longDescription:
			"LLM Gateway supports over 19 different LLM providers, including OpenAI, Anthropic, Google, AWS Bedrock, Azure, and many more. Access cutting-edge models from multiple providers without managing separate integrations.",
		icon: null,
		demoComponent: "multi-provider",
		benefits: [
			{
				title: "19+ Providers",
				description:
					"OpenAI, Anthropic, Google, Together AI, Groq, xAI, and more",
			},
			{
				title: "100+ Models",
				description: "Access to the latest and greatest AI models",
			},
			{
				title: "Automatic Routing",
				description:
					"Intelligent routing to the best provider for your request",
			},
			{
				title: "Fallback Support",
				description: "Automatic fallback to alternative providers if one fails",
			},
		],
		useCases: [
			{
				title: "Model Comparison",
				description:
					"Test different models to find the best one for your use case",
			},
			{
				title: "Load Balancing",
				description: "Distribute requests across multiple providers",
			},
			{
				title: "High Availability",
				description: "Ensure uptime with automatic failover",
			},
		],
	},
	{
		id: "performance-monitoring",
		slug: "performance-monitoring",
		title: "Performance Monitoring",
		subtitle: "Track and optimize your LLM usage",
		description:
			"Compare different models' performance and cost-effectiveness.",
		longDescription:
			"Get detailed insights into your LLM usage with comprehensive performance monitoring. Track latency, throughput, error rates, and costs across all your requests. Compare different models and providers to optimize for performance and cost.",
		icon: null,
		demoComponent: "performance-monitoring",
		benefits: [
			{
				title: "Real-Time Metrics",
				description:
					"Monitor latency, throughput, and error rates in real-time",
			},
			{
				title: "Historical Data",
				description: "Analyze trends and patterns over time",
			},
			{
				title: "Model Comparison",
				description:
					"Compare performance across different models and providers",
			},
			{
				title: "Cost Analysis",
				description:
					"Track spending and identify cost optimization opportunities",
			},
		],
		useCases: [
			{
				title: "Performance Optimization",
				description: "Identify bottlenecks and optimize for speed",
			},
			{
				title: "Cost Management",
				description: "Monitor spending and control costs",
			},
			{
				title: "Quality Assurance",
				description: "Track error rates and ensure reliability",
			},
		],
	},
	{
		id: "secure-key-management",
		slug: "secure-key-management",
		title: "Secure Key Management",
		subtitle: "Centralized API key management",
		description: "Manage API keys for different providers in one secure place.",
		longDescription:
			"Securely store and manage API keys for all your LLM providers in one place. Create project-specific keys, set usage limits, and track usage per key. Rotate keys without downtime and audit key usage.",
		icon: null,
		demoComponent: "api-key",
		benefits: [
			{
				title: "Centralized Storage",
				description:
					"Store all provider API keys in one secure, encrypted location",
			},
			{
				title: "Granular Access Control",
				description: "Create project-specific keys with custom permissions",
			},
			{
				title: "Usage Limits",
				description: "Set spending limits and rate limits per API key",
			},
			{
				title: "Audit Logs",
				description: "Track all API key usage and changes",
			},
		],
		useCases: [
			{
				title: "Team Collaboration",
				description: "Share access to LLM providers across your team",
			},
			{
				title: "Cost Control",
				description: "Set budgets and limits for different projects or teams",
			},
			{
				title: "Security Compliance",
				description:
					"Meet security requirements with centralized key management",
			},
		],
	},
	{
		id: "self-hosted",
		slug: "self-hosted-or-cloud",
		title: "Self-Hosted or Cloud",
		subtitle: "Deploy anywhere",
		description: "Deploy on your own infrastructure or use our hosted version.",
		longDescription:
			"LLM Gateway offers flexible deployment options. Use our hosted cloud version for instant setup, or deploy on your own infrastructure for complete control. Both options provide the same features and performance.",
		icon: null,
		benefits: [
			{
				title: "Cloud Hosted",
				description:
					"Get started in minutes with our fully managed cloud service",
			},
			{
				title: "Self-Hosted",
				description: "Deploy on your infrastructure for complete control",
			},
			{
				title: "Docker Support",
				description: "Easy deployment with Docker and Docker Compose",
			},
			{
				title: "Open Source",
				description:
					"Core features available under AGPLv3 license for transparency",
			},
		],
		useCases: [
			{
				title: "Data Privacy",
				description:
					"Keep sensitive data on your own infrastructure with self-hosting",
			},
			{
				title: "Compliance",
				description: "Meet regulatory requirements with on-premise deployment",
			},
			{
				title: "Fast Setup",
				description: "Get started quickly with our cloud-hosted option",
			},
		],
	},
	{
		id: "cost-analytics",
		slug: "cost-aware-analytics",
		title: "Cost-Aware Analytics",
		subtitle: "Understand your LLM spending",
		description:
			"See requests, tokens, total spend, and average cost per 1K tokens across 7 or 30 days.",
		longDescription:
			"Get complete visibility into your LLM costs with detailed analytics. Track requests, tokens, and spending over time. See cost per 1K tokens, compare providers, and identify cost optimization opportunities.",
		icon: null,
		demoComponent: "cost-analytics",
		benefits: [
			{
				title: "Detailed Cost Tracking",
				description: "Track spending down to the individual request level",
			},
			{
				title: "Token Usage",
				description: "Monitor input and output token usage across all requests",
			},
			{
				title: "Cost per 1K Tokens",
				description: "Understand the real cost of your LLM usage",
			},
			{
				title: "Time-Based Analysis",
				description: "View costs over 7 days, 30 days, or custom periods",
			},
		],
		useCases: [
			{
				title: "Budget Management",
				description: "Track spending against budgets and forecasts",
			},
			{
				title: "Cost Allocation",
				description: "Allocate costs to different projects or departments",
			},
			{
				title: "Provider Comparison",
				description: "Compare costs across different providers and models",
			},
		],
	},
	{
		id: "model-breakdown",
		slug: "per-model-provider-breakdown",
		title: "Per-Model/Provider Breakdown",
		subtitle: "Granular usage insights",
		description:
			"Break down usage and spend by provider and model so you can quickly spot expensive outliers.",
		longDescription:
			"See exactly where your money is going with per-model and per-provider breakdowns. Identify which models and providers are most expensive, and optimize your usage accordingly.",
		icon: null,
		demoComponent: "model-breakdown",
		benefits: [
			{
				title: "Model-Level Analytics",
				description: "Track usage and costs for each individual model",
			},
			{
				title: "Provider Comparison",
				description: "Compare costs and performance across providers",
			},
			{
				title: "Outlier Detection",
				description: "Quickly identify expensive requests or unusual patterns",
			},
			{
				title: "Optimization Insights",
				description: "Get recommendations for cost optimization",
			},
		],
		useCases: [
			{
				title: "Cost Optimization",
				description:
					"Identify and switch from expensive models to cheaper ones",
			},
			{
				title: "Performance Analysis",
				description: "Compare model performance for your specific use case",
			},
			{
				title: "Budget Planning",
				description: "Forecast future costs based on historical usage",
			},
		],
	},
	{
		id: "error-monitoring",
		slug: "errors-reliability-monitoring",
		title: "Errors & Reliability Monitoring",
		subtitle: "Ensure high availability",
		description:
			"Monitor error rate, cache hit rate, and reliability trends directly from the dashboard.",
		longDescription:
			"Keep your LLM applications running smoothly with comprehensive error and reliability monitoring. Track error rates, identify issues before they become problems, and ensure high availability.",
		icon: null,
		demoComponent: "errors-monitoring",
		benefits: [
			{
				title: "Error Rate Tracking",
				description: "Monitor error rates across all providers and models",
			},
			{
				title: "Cache Hit Rate",
				description: "Track cache efficiency and optimize for cost savings",
			},
			{
				title: "Reliability Metrics",
				description: "Monitor uptime and availability of your LLM services",
			},
			{
				title: "Alerting",
				description:
					"Get notified when error rates exceed acceptable thresholds",
			},
		],
		useCases: [
			{
				title: "Proactive Monitoring",
				description: "Catch issues before they affect your users",
			},
			{
				title: "SLA Compliance",
				description: "Track and ensure you meet your SLA commitments",
			},
			{
				title: "Incident Response",
				description: "Quickly identify and resolve issues",
			},
		],
	},
	{
		id: "usage-explorer",
		slug: "project-level-usage-explorer",
		title: "Project-Level Usage Explorer",
		subtitle: "Deep-dive into your usage",
		description:
			"Drill into each project's requests, models, errors, cache, and costs with dedicated charts and tables.",
		longDescription:
			"Explore your LLM usage at the project level with detailed charts, tables, and analytics. See every request, track model usage, monitor errors, and analyze costs for each of your projects.",
		icon: null,
		demoComponent: "activity-logs",
		benefits: [
			{
				title: "Request-Level Details",
				description: "View every request with full context and metadata",
			},
			{
				title: "Model Usage Tracking",
				description: "See which models are used most in each project",
			},
			{
				title: "Error Analysis",
				description: "Identify and debug errors at the project level",
			},
			{
				title: "Cost Breakdown",
				description: "Track costs per project for accurate billing",
			},
		],
		useCases: [
			{
				title: "Multi-Project Management",
				description: "Manage multiple projects from a single dashboard",
			},
			{
				title: "Client Billing",
				description: "Track usage per client for accurate invoicing",
			},
			{
				title: "Usage Optimization",
				description: "Optimize usage for each project individually",
			},
		],
	},
	{
		id: "audit-logs",
		slug: "audit-logs",
		title: "Enterprise Audit Logs",
		subtitle: "Complete visibility into every action",
		description:
			"Track who did what, when, and maintain compliance with comprehensive audit trails.",
		longDescription:
			"Enterprise Audit Logs provide complete visibility into every action taken within your organization. Track user activity, configuration changes, API key management, and more. Maintain compliance requirements with immutable, time-stamped records that can be filtered and exported.",
		icon: null,
		benefits: [
			{
				title: "Complete Activity History",
				description:
					"Track every action across your organization including logins, configuration changes, and API operations",
			},
			{
				title: "Compliance Ready",
				description:
					"Meet SOC 2, HIPAA, and other regulatory requirements with detailed audit trails",
			},
			{
				title: "User Attribution",
				description:
					"See exactly who made each change with timestamps and user details",
			},
			{
				title: "Searchable & Filterable",
				description:
					"Filter logs by user, action type, resource, or time range to find exactly what you need",
			},
		],
		useCases: [
			{
				title: "Security Investigations",
				description:
					"Quickly trace suspicious activity and identify potential security incidents",
			},
			{
				title: "Regulatory Compliance",
				description:
					"Demonstrate compliance with detailed records of all system access and changes",
			},
			{
				title: "Operational Visibility",
				description:
					"Understand how your team uses the platform and identify optimization opportunities",
			},
		],
	},
	{
		id: "guardrails",
		slug: "guardrails",
		title: "LLM Guardrails",
		subtitle: "Protect your AI applications",
		description:
			"Prevent prompt injection, detect PII, and block malicious requests with intelligent guardrails.",
		longDescription:
			"LLM Guardrails provide comprehensive protection for your AI applications. Automatically detect and block prompt injection attacks, jailbreak attempts, and sensitive data leakage. Configure custom rules for blocked terms, topic restrictions, and file handling to ensure your LLM usage stays safe and compliant.",
		icon: null,
		benefits: [
			{
				title: "Prompt Injection Protection",
				description:
					"Detect and block attempts to manipulate your AI through malicious prompts",
			},
			{
				title: "PII Detection & Redaction",
				description:
					"Automatically detect and redact sensitive personal information before it reaches the LLM",
			},
			{
				title: "Secrets Detection",
				description:
					"Prevent API keys, passwords, and other secrets from being exposed in prompts",
			},
			{
				title: "Custom Rules Engine",
				description:
					"Create custom rules for blocked terms, regex patterns, and topic restrictions",
			},
		],
		useCases: [
			{
				title: "Data Privacy Compliance",
				description:
					"Ensure GDPR and CCPA compliance by preventing PII from being sent to external LLMs",
			},
			{
				title: "Security Hardening",
				description:
					"Protect against jailbreak attempts and prompt injection attacks",
			},
			{
				title: "Content Moderation",
				description:
					"Block inappropriate content and enforce topic boundaries for your AI applications",
			},
		],
	},
];

export function getFeatureBySlug(slug: string): FeatureDefinition | undefined {
	return features.find((f) => f.slug === slug);
}
