import {
	boolean,
	decimal,
	index,
	integer,
	json,
	jsonb,
	pgTable,
	real,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";
import { customAlphabet } from "nanoid";

import type { errorDetails, tools, toolChoice, toolResults } from "./types.js";
import type z from "zod";

export const UnifiedFinishReason = {
	COMPLETED: "completed",
	LENGTH_LIMIT: "length_limit",
	CONTENT_FILTER: "content_filter",
	TOOL_CALLS: "tool_calls",
	GATEWAY_ERROR: "gateway_error",
	UPSTREAM_ERROR: "upstream_error",
	CLIENT_ERROR: "client_error",
	CANCELED: "canceled",
	UNKNOWN: "unknown",
} as const;

export type UnifiedFinishReason =
	(typeof UnifiedFinishReason)[keyof typeof UnifiedFinishReason];

const generate = customAlphabet(
	"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
);

export const shortid = (size = 20) => generate(size);

export const user = pgTable("user", {
	id: text().primaryKey().$defaultFn(shortid),
	createdAt: timestamp().notNull().defaultNow(),
	updatedAt: timestamp()
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
	name: text(),
	email: text().notNull().unique(),
	emailVerified: boolean().notNull().default(false),
	image: text(),
	onboardingCompleted: boolean().notNull().default(false),
});

export const session = pgTable(
	"session",
	{
		id: text().primaryKey().$defaultFn(shortid),
		expiresAt: timestamp().notNull().defaultNow(),
		token: text().notNull().unique(),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		ipAddress: text(),
		userAgent: text(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = pgTable(
	"account",
	{
		id: text().primaryKey().$defaultFn(shortid),
		accountId: text().notNull(),
		providerId: text().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text(),
		refreshToken: text(),
		idToken: text(),
		accessTokenExpiresAt: timestamp(),
		refreshTokenExpiresAt: timestamp(),
		scope: text(),
		password: text(),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = pgTable("verification", {
	id: text().primaryKey().$defaultFn(shortid),
	identifier: text().notNull(),
	value: text().notNull(),
	expiresAt: timestamp().notNull().defaultNow(),
	createdAt: timestamp(),
	updatedAt: timestamp().$onUpdate(() => new Date()),
});

export const organization = pgTable("organization", {
	id: text().primaryKey().notNull().$defaultFn(shortid),
	createdAt: timestamp().notNull().defaultNow(),
	updatedAt: timestamp()
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
	name: text().notNull(),
	stripeCustomerId: text().unique(),
	stripeSubscriptionId: text().unique(),
	credits: decimal().notNull().default("0"),
	autoTopUpEnabled: boolean().notNull().default(false),
	autoTopUpThreshold: decimal().default("10"),
	autoTopUpAmount: decimal().default("10"),
	plan: text({
		enum: ["free", "pro"],
	})
		.notNull()
		.default("free"),
	planExpiresAt: timestamp(),
	subscriptionCancelled: boolean().notNull().default(false),
	trialStartDate: timestamp(),
	trialEndDate: timestamp(),
	isTrialActive: boolean().notNull().default(false),
	retentionLevel: text({
		enum: ["retain", "none"],
	})
		.notNull()
		.default("retain"),
	status: text({
		enum: ["active", "inactive", "deleted"],
	}).default("active"),
});

export const transaction = pgTable(
	"transaction",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		organizationId: text()
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		type: text({
			enum: [
				"subscription_start",
				"subscription_cancel",
				"subscription_end",
				"credit_topup",
			],
		}).notNull(),
		amount: decimal(),
		creditAmount: decimal(),
		currency: text().notNull().default("USD"),
		status: text({
			enum: ["pending", "completed", "failed"],
		})
			.notNull()
			.default("completed"),
		stripePaymentIntentId: text(),
		stripeInvoiceId: text(),
		description: text(),
	},
	(table) => [
		index("transaction_organization_id_idx").on(table.organizationId),
	],
);

export const userOrganization = pgTable(
	"user_organization",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		organizationId: text()
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		role: text({
			enum: ["owner", "admin", "developer"],
		})
			.notNull()
			.default("owner"),
	},
	(table) => [
		index("user_organization_user_id_idx").on(table.userId),
		index("user_organization_organization_id_idx").on(table.organizationId),
	],
);

export const project = pgTable(
	"project",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		name: text().notNull(),
		organizationId: text()
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		cachingEnabled: boolean().notNull().default(false),
		cacheDurationSeconds: integer().notNull().default(60),
		mode: text({
			enum: ["api-keys", "credits", "hybrid"],
		})
			.notNull()
			.default("hybrid"),
		status: text({
			enum: ["active", "inactive", "deleted"],
		}).default("active"),
	},
	(table) => [index("project_organization_id_idx").on(table.organizationId)],
);

export const apiKey = pgTable(
	"api_key",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		token: text().notNull().unique(),
		description: text().notNull(),
		status: text({
			enum: ["active", "inactive", "deleted"],
		}).default("active"),
		usageLimit: decimal(),
		usage: decimal().notNull().default("0"),
		projectId: text()
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		createdBy: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("api_key_project_id_idx").on(table.projectId),
		index("api_key_created_by_idx").on(table.createdBy),
	],
);

export const apiKeyIamRule = pgTable(
	"api_key_iam_rule",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		apiKeyId: text()
			.notNull()
			.references(() => apiKey.id, { onDelete: "cascade" }),
		ruleType: text({
			enum: [
				"allow_models",
				"deny_models",
				"allow_pricing",
				"deny_pricing",
				"allow_providers",
				"deny_providers",
			],
		}).notNull(),
		ruleValue: json()
			.$type<{
				models?: string[];
				providers?: string[];
				pricingType?: "free" | "paid";
				maxInputPrice?: number;
				maxOutputPrice?: number;
			}>()
			.notNull(),
		status: text({
			enum: ["active", "inactive"],
		})
			.notNull()
			.default("active"),
	},
	(table) => [
		index("api_key_iam_rule_api_key_id_idx").on(table.apiKeyId),
		index("api_key_iam_rule_rule_type_idx").on(table.ruleType),
		index("api_key_iam_rule_api_key_id_status_idx").on(
			table.apiKeyId,
			table.status,
		),
	],
);

export interface ProviderKeyOptions {
	aws_bedrock_region_prefix?: string;
}

export const providerKey = pgTable(
	"provider_key",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		token: text().notNull(),
		provider: text().notNull(),
		name: text(), // Optional name for custom providers (lowercase a-z only)
		baseUrl: text(), // Optional base URL for custom providers
		options: jsonb().$type<ProviderKeyOptions>(),
		status: text({
			enum: ["active", "inactive", "deleted"],
		}).default("active"),
		organizationId: text()
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
	},
	(table) => [
		unique().on(table.organizationId, table.name),
		index("provider_key_organization_id_idx").on(table.organizationId),
	],
);

export const log = pgTable(
	"log",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		requestId: text().notNull(),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		organizationId: text().notNull(),
		projectId: text().notNull(),
		apiKeyId: text().notNull(),
		duration: integer().notNull(),
		timeToFirstToken: integer(),
		timeToFirstReasoningToken: integer(),
		requestedModel: text().notNull(),
		requestedProvider: text(),
		usedModel: text().notNull(),
		usedModelMapping: text(),
		usedProvider: text().notNull(),
		responseSize: integer().notNull(),
		content: text(),
		reasoningContent: text(),
		tools: json().$type<z.infer<typeof tools>>(),
		toolChoice: json().$type<z.infer<typeof toolChoice>>(),
		toolResults: json().$type<z.infer<typeof toolResults>>(),
		finishReason: text(),
		unifiedFinishReason: text(),
		promptTokens: decimal(),
		completionTokens: decimal(),
		totalTokens: decimal(),
		reasoningTokens: decimal(),
		cachedTokens: decimal(),
		messages: json(),
		temperature: real(),
		maxTokens: integer(),
		topP: real(),
		frequencyPenalty: real(),
		presencePenalty: real(),
		reasoningEffort: text(),
		responseFormat: json(),
		hasError: boolean().default(false),
		errorDetails: json().$type<z.infer<typeof errorDetails>>(),
		cost: real(),
		inputCost: real(),
		outputCost: real(),
		cachedInputCost: real(),
		requestCost: real(),
		estimatedCost: boolean().default(false),
		discount: real(),
		canceled: boolean().default(false),
		streamed: boolean().default(false),
		cached: boolean().default(false),
		mode: text({
			enum: ["api-keys", "credits", "hybrid"],
		}).notNull(),
		usedMode: text({
			enum: ["api-keys", "credits"],
		}).notNull(),
		source: text(),
		customHeaders: json().$type<{ [key: string]: string }>(),
		processedAt: timestamp(),
		rawRequest: jsonb(),
		rawResponse: jsonb(),
		upstreamRequest: jsonb(),
		upstreamResponse: jsonb(),
		traceId: text(),
	},
	(table) => [
		index("log_project_id_created_at_idx").on(table.projectId, table.createdAt),
		// Index for worker stats queries: WHERE createdAt >= ? AND createdAt < ? GROUP BY usedModel, usedProvider
		index("log_created_at_used_model_used_provider_idx").on(
			table.createdAt,
			table.usedModel,
			table.usedProvider,
		),
	],
);

export const passkey = pgTable(
	"passkey",
	{
		id: text().primaryKey().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		name: text(),
		publicKey: text().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		credentialID: text().notNull(),
		counter: integer().notNull(),
		deviceType: text(),
		backedUp: boolean(),
		transports: text(),
	},
	(table) => [index("passkey_user_id_idx").on(table.userId)],
);

export const paymentMethod = pgTable(
	"payment_method",
	{
		id: text().primaryKey().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp().notNull().defaultNow(),
		stripePaymentMethodId: text().notNull(),
		organizationId: text()
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		type: text().notNull(), // "card", "sepa_debit", etc.
		isDefault: boolean().notNull().default(false),
	},
	(table) => [
		index("payment_method_organization_id_idx").on(table.organizationId),
	],
);

export const organizationAction = pgTable(
	"organization_action",
	{
		id: text().primaryKey().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		organizationId: text()
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		type: text({
			enum: ["credit", "debit"],
		}).notNull(),
		amount: decimal().notNull(),
		description: text(),
	},
	(table) => [
		index("organization_action_organization_id_idx").on(table.organizationId),
	],
);

export const lock = pgTable("lock", {
	id: text().primaryKey().$defaultFn(shortid),
	createdAt: timestamp().notNull().defaultNow(),
	updatedAt: timestamp()
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
	key: text().notNull().unique(),
});

export const chat = pgTable(
	"chat",
	{
		id: text().primaryKey().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		title: text().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		model: text().notNull(),
		status: text({
			enum: ["active", "archived", "deleted"],
		}).default("active"),
	},
	(table) => [index("chat_user_id_idx").on(table.userId)],
);

export const message = pgTable(
	"message",
	{
		id: text().primaryKey().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		chatId: text()
			.notNull()
			.references(() => chat.id, { onDelete: "cascade" }),
		role: text({
			enum: ["user", "assistant", "system"],
		}).notNull(),
		content: text(), // Made nullable to support image-only messages
		images: text(), // JSON string to store images array
		reasoning: text(), // Reasoning content from AI models
		sequence: integer().notNull(), // To maintain message order
	},
	(table) => [index("message_chat_id_idx").on(table.chatId)],
);

export const installation = pgTable("installation", {
	id: text().primaryKey().$defaultFn(shortid),
	createdAt: timestamp().notNull().defaultNow(),
	updatedAt: timestamp()
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
	uuid: text().notNull().unique(),
	type: text().notNull(),
});

export const provider = pgTable(
	"provider",
	{
		id: text().primaryKey(),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		name: text().notNull(),
		description: text().notNull(),
		streaming: boolean(),
		cancellation: boolean(),
		jsonOutput: boolean(),
		color: text(),
		website: text(),
		announcement: text(),
		status: text({
			enum: ["active", "inactive"],
		})
			.notNull()
			.default("active"),
		logsCount: integer().notNull().default(0),
		errorsCount: integer().notNull().default(0),
		clientErrorsCount: integer().notNull().default(0),
		gatewayErrorsCount: integer().notNull().default(0),
		upstreamErrorsCount: integer().notNull().default(0),
		cachedCount: integer().notNull().default(0),
		avgTimeToFirstToken: real(),
		avgTimeToFirstReasoningToken: real(),
		statsUpdatedAt: timestamp(),
	},
	(table) => [index("provider_status_idx").on(table.status)],
);

export const model = pgTable(
	"model",
	{
		id: text().primaryKey(),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		name: text(),
		family: text().notNull(),
		jsonOutput: boolean(),
		free: boolean(),
		deprecatedAt: timestamp(),
		deactivatedAt: timestamp(),
		output: json().$type<string[]>(),
		status: text({
			enum: ["active", "inactive"],
		})
			.notNull()
			.default("active"),
		logsCount: integer().notNull().default(0),
		errorsCount: integer().notNull().default(0),
		clientErrorsCount: integer().notNull().default(0),
		gatewayErrorsCount: integer().notNull().default(0),
		upstreamErrorsCount: integer().notNull().default(0),
		cachedCount: integer().notNull().default(0),
		avgTimeToFirstToken: real(),
		avgTimeToFirstReasoningToken: real(),
		statsUpdatedAt: timestamp(),
	},
	(table) => [index("model_status_idx").on(table.status)],
);

export const modelProviderMapping = pgTable(
	"model_provider_mapping",
	{
		id: text().primaryKey().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		modelId: text()
			.notNull()
			.references(() => model.id, { onDelete: "cascade" }),
		providerId: text()
			.notNull()
			.references(() => provider.id, { onDelete: "cascade" }),
		modelName: text().notNull(),
		inputPrice: decimal(),
		outputPrice: decimal(),
		cachedInputPrice: decimal(),
		imageInputPrice: decimal(),
		requestPrice: decimal(),
		contextSize: integer(),
		maxOutput: integer(),
		streaming: boolean().notNull().default(false),
		vision: boolean(),
		reasoning: boolean(),
		reasoningOutput: text(),
		tools: boolean(),
		supportedParameters: json().$type<string[]>(),
		test: text({
			enum: ["skip", "only"],
		}),
		status: text({
			enum: ["active", "inactive"],
		})
			.notNull()
			.default("active"),
		logsCount: integer().notNull().default(0),
		errorsCount: integer().notNull().default(0),
		clientErrorsCount: integer().notNull().default(0),
		gatewayErrorsCount: integer().notNull().default(0),
		upstreamErrorsCount: integer().notNull().default(0),
		cachedCount: integer().notNull().default(0),
		avgTimeToFirstToken: real(),
		avgTimeToFirstReasoningToken: real(),
		statsUpdatedAt: timestamp(),
	},
	(table) => [
		unique().on(table.modelId, table.providerId),
		index("model_provider_mapping_status_idx").on(table.status),
	],
);

export const modelProviderMappingHistory = pgTable(
	"model_provider_mapping_history",
	{
		id: text().primaryKey().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		modelId: text().notNull(), // LLMGateway model name (e.g., "gpt-4")
		providerId: text().notNull(), // Provider ID (e.g., "openai")
		modelProviderMappingId: text().notNull(), // Reference to the exact model_provider_mapping.id
		// Unique timestamp key for one-minute intervals (rounded down to the minute)
		minuteTimestamp: timestamp().notNull(),
		logsCount: integer().notNull().default(0),
		errorsCount: integer().notNull().default(0),
		clientErrorsCount: integer().notNull().default(0),
		gatewayErrorsCount: integer().notNull().default(0),
		upstreamErrorsCount: integer().notNull().default(0),
		cachedCount: integer().notNull().default(0),
		totalInputTokens: integer().notNull().default(0),
		totalOutputTokens: integer().notNull().default(0),
		totalTokens: integer().notNull().default(0),
		totalReasoningTokens: integer().notNull().default(0),
		totalCachedTokens: integer().notNull().default(0),
		totalDuration: integer().notNull().default(0),
		totalTimeToFirstToken: integer().notNull().default(0),
		totalTimeToFirstReasoningToken: integer().notNull().default(0),
	},
	(table) => [
		// Unique constraint ensures one record per mapping-minute combination
		unique().on(table.modelProviderMappingId, table.minuteTimestamp),
		// Index for ORDER BY minuteTimestamp DESC queries
		index("model_provider_mapping_history_minute_timestamp_idx").on(
			table.minuteTimestamp,
		),
		// Composite index for aggregation queries by providerId
		index("model_provider_mapping_history_minute_timestamp_provider_id_idx").on(
			table.minuteTimestamp,
			table.providerId,
		),
		// Composite index for aggregation queries by modelId
		index("model_provider_mapping_history_minute_timestamp_model_id_idx").on(
			table.minuteTimestamp,
			table.modelId,
		),
	],
);

export const modelHistory = pgTable(
	"model_history",
	{
		id: text().primaryKey().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		modelId: text().notNull(),
		// Unique timestamp key for one-minute intervals (rounded down to the minute)
		minuteTimestamp: timestamp().notNull(),
		logsCount: integer().notNull().default(0),
		errorsCount: integer().notNull().default(0),
		clientErrorsCount: integer().notNull().default(0),
		gatewayErrorsCount: integer().notNull().default(0),
		upstreamErrorsCount: integer().notNull().default(0),
		cachedCount: integer().notNull().default(0),
		totalInputTokens: integer().notNull().default(0),
		totalOutputTokens: integer().notNull().default(0),
		totalTokens: integer().notNull().default(0),
		totalReasoningTokens: integer().notNull().default(0),
		totalCachedTokens: integer().notNull().default(0),
		totalDuration: integer().notNull().default(0),
		totalTimeToFirstToken: integer().notNull().default(0),
		totalTimeToFirstReasoningToken: integer().notNull().default(0),
	},
	(table) => [
		// Unique constraint ensures one record per model-minute combination
		unique().on(table.modelId, table.minuteTimestamp),
		// Index for ORDER BY minuteTimestamp DESC queries
		index("model_history_minute_timestamp_idx").on(table.minuteTimestamp),
	],
);
