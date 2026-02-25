import { sql } from "drizzle-orm";
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
	billingEmail: text().notNull(),
	billingCompany: text(),
	billingAddress: text(),
	billingTaxId: text(),
	billingNotes: text(),
	stripeCustomerId: text().unique(),
	stripeSubscriptionId: text().unique(),
	credits: decimal().notNull().default("0"),
	autoTopUpEnabled: boolean().notNull().default(false),
	autoTopUpThreshold: decimal().default("10"),
	autoTopUpAmount: decimal().default("10"),
	plan: text({
		enum: ["free", "pro", "enterprise"],
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
		.default("none"),
	status: text({
		enum: ["active", "inactive", "deleted"],
	}).default("active"),
	referralEarnings: decimal().notNull().default("0"),
	paymentFailureCount: integer().notNull().default(0),
	lastPaymentFailureAt: timestamp(),
	// Dev Plans fields (for personal accounts)
	isPersonal: boolean().notNull().default(false),
	devPlan: text({
		enum: ["none", "lite", "pro", "max"],
	})
		.notNull()
		.default("none"),
	devPlanCreditsUsed: decimal().notNull().default("0"),
	devPlanCreditsLimit: decimal().notNull().default("0"),
	devPlanBillingCycleStart: timestamp(),
	devPlanStripeSubscriptionId: text().unique(),
	devPlanCancelled: boolean().notNull().default(false),
	devPlanExpiresAt: timestamp(),
	devPlanAllowAllModels: boolean().notNull().default(false),
});

export const referral = pgTable(
	"referral",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		referrerOrganizationId: text()
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		referredOrganizationId: text()
			.notNull()
			.unique()
			.references(() => organization.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("referral_referrer_organization_id_idx").on(
			table.referrerOrganizationId,
		),
		index("referral_referred_organization_id_idx").on(
			table.referredOrganizationId,
		),
	],
);

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
				"credit_refund",
				"credit_gift",
				"dev_plan_start",
				"dev_plan_upgrade",
				"dev_plan_downgrade",
				"dev_plan_cancel",
				"dev_plan_end",
				"dev_plan_renewal",
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
		relatedTransactionId: text(),
		refundReason: text(),
	},
	(table) => [
		index("transaction_organization_id_idx").on(table.organizationId),
	],
);

export const followUpEmail = pgTable(
	"follow_up_email",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		organizationId: text()
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		emailType: text({
			enum: ["no_purchase", "low_usage", "no_repurchase"],
		}).notNull(),
		sentTo: text().notNull(),
	},
	(table) => [
		unique().on(table.organizationId, table.emailType),
		index("follow_up_email_organization_id_idx").on(table.organizationId),
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
	aws_bedrock_region_prefix?: "us." | "global." | "eu.";
	azure_resource?: string;
	azure_api_version?: string;
	azure_deployment_type?: "openai" | "ai-foundry";
	azure_validation_model?: string;
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
		reasoningMaxTokens: integer(),
		effort: text(),
		responseFormat: json(),
		hasError: boolean().default(false),
		errorDetails: json().$type<z.infer<typeof errorDetails>>(),
		cost: real(),
		inputCost: real(),
		outputCost: real(),
		cachedInputCost: real(),
		requestCost: real(),
		webSearchCost: real(),
		imageInputTokens: decimal(),
		imageOutputTokens: decimal(),
		imageInputCost: real(),
		imageOutputCost: real(),
		estimatedCost: boolean().default(false),
		discount: real(),
		pricingTier: text(),
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
		routingMetadata: json().$type<{
			availableProviders?: string[];
			selectedProvider?: string;
			selectionReason?: string;
			providerScores?: Array<{
				providerId: string;
				score: number;
				uptime?: number;
				latency?: number;
				throughput?: number;
				price?: number;
				priority?: number;
				failed?: boolean;
				status_code?: number;
				error_type?: string;
			}>;
			originalProvider?: string;
			originalProviderUptime?: number;
			noFallback?: boolean;
			routing?: Array<{
				provider: string;
				model: string;
				status_code: number;
				error_type: string;
				succeeded: boolean;
			}>;
		}>(),
		processedAt: timestamp(),
		rawRequest: jsonb(),
		rawResponse: jsonb(),
		upstreamRequest: jsonb(),
		upstreamResponse: jsonb(),
		traceId: text(),
		dataRetentionCleanedUp: boolean().default(false),
		dataStorageCost: decimal().notNull().default("0"),
		params: json().$type<{
			image_config?: {
				aspect_ratio?: string;
				image_size?: string;
			};
		}>(),
		userAgent: text(),
		plugins: json().$type<string[]>(),
		pluginResults: json().$type<{
			responseHealing?: {
				healed: boolean;
				healingMethod?: string;
			};
		}>(),
		retried: boolean().default(false),
		retriedByLogId: text(),
	},
	(table) => [
		index("log_project_id_created_at_idx").on(table.projectId, table.createdAt),
		// Index for worker stats queries: WHERE createdAt >= ? AND createdAt < ? GROUP BY usedModel, usedProvider
		index("log_created_at_used_model_used_provider_idx").on(
			table.createdAt,
			table.usedModel,
			table.usedProvider,
		),
		// Partial index for data retention cleanup: created_at for range filtering
		// Only indexes rows that need cleanup (data_retention_cleaned_up = false)
		index("log_data_retention_pending_idx")
			.on(table.createdAt)
			.where(sql`data_retention_cleaned_up = false`),
		// Index for distinct usedModel queries by project
		index("log_project_id_used_model_idx").on(table.projectId, table.usedModel),
		// Partial index for batch credit processing: only indexes unprocessed logs
		index("log_processed_at_null_idx")
			.on(table.createdAt)
			.where(sql`processed_at IS NULL`),
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
		webSearch: boolean().default(false),
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
		tools: text(), // JSON string to store tool call parts
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
		releasedAt: timestamp().defaultNow().notNull(),
		name: text().default("(empty)").notNull(),
		aliases: json().$type<string[]>().default([]).notNull(),
		description: text().default("(empty)").notNull(),
		family: text().notNull(),
		free: boolean().default(false).notNull(),
		output: json().$type<string[]>().default(["text"]).notNull(),
		stability: text({
			enum: ["stable", "beta", "unstable", "experimental"],
		})
			.default("stable")
			.notNull(),
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
		reasoningMaxTokens: boolean().notNull().default(false),
		reasoningOutput: text(),
		tools: boolean(),
		jsonOutput: boolean().default(false).notNull(),
		jsonOutputSchema: boolean().default(false).notNull(),
		webSearch: boolean().default(false).notNull(),
		webSearchPrice: decimal(),
		discount: decimal().default("0").notNull(),
		stability: text({
			enum: ["stable", "beta", "unstable", "experimental"],
		})
			.default("stable")
			.notNull(),
		supportedParameters: json().$type<string[]>(),
		test: text({
			enum: ["skip", "only"],
		}),
		deprecatedAt: timestamp(),
		deactivatedAt: timestamp(),
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
		routingUptime: real(),
		routingLatency: real(),
		routingThroughput: real(),
		routingTotalRequests: integer(),
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

// Audit Log - Enterprise feature for tracking all API actions
export const auditLogActions = [
	// Organization
	"organization.create",
	"organization.update",
	"organization.delete",
	// Project
	"project.create",
	"project.update",
	"project.delete",
	// Team
	"team_member.add",
	"team_member.update",
	"team_member.remove",
	// API Key
	"api_key.create",
	"api_key.update_status",
	"api_key.update_limit",
	"api_key.delete",
	"api_key.iam_rule.create",
	"api_key.iam_rule.update",
	"api_key.iam_rule.delete",
	// Provider Key
	"provider_key.create",
	"provider_key.update",
	"provider_key.delete",
	// Subscription
	"subscription.create",
	"subscription.cancel",
	"subscription.resume",
	"subscription.upgrade_yearly",
	// Payment
	"payment.method.set_default",
	"payment.method.delete",
	"payment.credit_topup",
	// Credits
	"credits.gift",
	// Dev Plan
	"dev_plan.subscribe",
	"dev_plan.cancel",
	"dev_plan.resume",
	"dev_plan.change_tier",
	"dev_plan.update_settings",
] as const;

export const auditLogResourceTypes = [
	"organization",
	"project",
	"team_member",
	"api_key",
	"iam_rule",
	"provider_key",
	"subscription",
	"payment_method",
	"payment",
	"dev_plan",
] as const;

export type AuditLogAction = (typeof auditLogActions)[number];
export type AuditLogResourceType = (typeof auditLogResourceTypes)[number];

export interface AuditLogMetadata {
	changes?: Record<string, { old: unknown; new: unknown }>;
	resourceName?: string;
	targetUserId?: string;
	targetUserEmail?: string;
	ipAddress?: string;
	userAgent?: string;
	[key: string]: unknown;
}

export const auditLog = pgTable(
	"audit_log",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		organizationId: text()
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		action: text({ enum: auditLogActions }).notNull(),
		resourceType: text({ enum: auditLogResourceTypes }).notNull(),
		resourceId: text(),
		metadata: jsonb().$type<AuditLogMetadata>(),
	},
	(table) => [
		index("audit_log_organization_id_created_at_idx").on(
			table.organizationId,
			table.createdAt,
		),
		index("audit_log_user_id_idx").on(table.userId),
		index("audit_log_action_idx").on(table.action),
		index("audit_log_resource_type_idx").on(table.resourceType),
	],
);

// Guardrails - Enterprise feature for content safety

export type GuardrailAction = "block" | "redact" | "warn" | "allow";

export interface SystemRuleConfig {
	enabled: boolean;
	action: GuardrailAction;
}

export interface SystemRulesConfig {
	prompt_injection: SystemRuleConfig;
	jailbreak: SystemRuleConfig;
	pii_detection: SystemRuleConfig;
	secrets: SystemRuleConfig;
	file_types: SystemRuleConfig;
	document_leakage: SystemRuleConfig;
}

export const defaultSystemRulesConfig: SystemRulesConfig = {
	prompt_injection: { enabled: true, action: "block" },
	jailbreak: { enabled: true, action: "block" },
	pii_detection: { enabled: true, action: "redact" },
	secrets: { enabled: true, action: "block" },
	file_types: { enabled: true, action: "block" },
	document_leakage: { enabled: false, action: "warn" },
};

export const defaultAllowedFileTypes = [
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
];

export const guardrailActionsTaken = ["blocked", "redacted", "warned"] as const;

export type GuardrailActionTaken = (typeof guardrailActionsTaken)[number];

export const customRuleTypes = [
	"blocked_terms",
	"custom_regex",
	"topic_restriction",
] as const;

export type CustomRuleType = (typeof customRuleTypes)[number];

export interface BlockedTermsRuleConfig {
	type: "blocked_terms";
	terms: string[];
	matchType: "exact" | "contains" | "regex";
	caseSensitive: boolean;
}

export interface CustomRegexRuleConfig {
	type: "custom_regex";
	pattern: string;
}

export interface TopicRestrictionRuleConfig {
	type: "topic_restriction";
	blockedTopics: string[];
	allowedTopics?: string[];
}

export type CustomRuleConfig =
	| BlockedTermsRuleConfig
	| CustomRegexRuleConfig
	| TopicRestrictionRuleConfig;

export const guardrailConfig = pgTable(
	"guardrail_config",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" })
			.unique(),
		enabled: boolean().default(true).notNull(),
		systemRules: jsonb("system_rules")
			.$type<SystemRulesConfig>()
			.default(defaultSystemRulesConfig),
		maxFileSizeMb: integer("max_file_size_mb").default(10).notNull(),
		allowedFileTypes: text("allowed_file_types")
			.array()
			.default(defaultAllowedFileTypes)
			.notNull(),
		piiAction: text("pii_action").$type<GuardrailAction>().default("redact"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		index("guardrail_config_organization_id_idx").on(table.organizationId),
	],
);

export const guardrailRule = pgTable(
	"guardrail_rule",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		name: text().notNull(),
		type: text({ enum: customRuleTypes }).notNull(),
		config: jsonb().$type<CustomRuleConfig>().notNull(),
		priority: integer().default(100).notNull(),
		enabled: boolean().default(true).notNull(),
		action: text().$type<GuardrailAction>().default("block").notNull(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		index("guardrail_rule_organization_id_idx").on(table.organizationId),
		index("guardrail_rule_priority_idx").on(table.priority),
	],
);

export const guardrailViolation = pgTable(
	"guardrail_violation",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		logId: text("log_id"),
		ruleId: text("rule_id").notNull(),
		ruleName: text("rule_name").notNull(),
		category: text().notNull(),
		actionTaken: text("action_taken", {
			enum: guardrailActionsTaken,
		}).notNull(),
		matchedPattern: text("matched_pattern"),
		matchedContent: text("matched_content"),
		contentHash: text("content_hash"),
		apiKeyId: text("api_key_id"),
		model: text(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => [
		index("guardrail_violation_org_created_idx").on(
			table.organizationId,
			table.createdAt,
		),
		index("guardrail_violation_rule_created_idx").on(
			table.ruleId,
			table.createdAt,
		),
	],
);

// Discount - Admin-configurable discounts for providers/models
// Can be global (organizationId = null) or org-specific
export const discount = pgTable(
	"discount",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		// Scope: null = global discount, otherwise org-specific
		organizationId: text().references(() => organization.id, {
			onDelete: "cascade",
		}),
		// Target: provider-only, model-only, or both
		// null provider = applies to all providers
		provider: text(),
		// null model = applies to all models (of provider if specified)
		model: text(),
		// Discount value (0-1, where 0.3 = 30% off, user pays 70%)
		discountPercent: decimal().notNull(),
		// Optional metadata
		reason: text(),
		expiresAt: timestamp(),
	},
	(table) => [
		// Unique constraint: one discount per org+provider+model combo
		// Using COALESCE to handle nulls in unique constraint
		unique("discount_org_provider_model_unique").on(
			table.organizationId,
			table.provider,
			table.model,
		),
		index("discount_organization_id_idx").on(table.organizationId),
		index("discount_provider_idx").on(table.provider),
		index("discount_model_idx").on(table.model),
	],
);

// Project hourly statistics aggregation - used for fast dashboard queries
export const projectHourlyStats = pgTable(
	"project_hourly_stats",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		projectId: text().notNull(),
		hourTimestamp: timestamp().notNull(), // Start of the hour bucket
		// Request counts
		requestCount: integer().notNull().default(0),
		errorCount: integer().notNull().default(0),
		cacheCount: integer().notNull().default(0),
		streamedCount: integer().notNull().default(0),
		nonStreamedCount: integer().notNull().default(0),
		// Unified finish reason counts
		completedCount: integer().notNull().default(0),
		lengthLimitCount: integer().notNull().default(0),
		contentFilterCount: integer().notNull().default(0),
		toolCallsCount: integer().notNull().default(0),
		canceledCount: integer().notNull().default(0),
		unknownFinishCount: integer().notNull().default(0),
		// Error type counts (subset of errorCount)
		clientErrorCount: integer().notNull().default(0),
		gatewayErrorCount: integer().notNull().default(0),
		upstreamErrorCount: integer().notNull().default(0),
		// Token counts
		inputTokens: decimal().notNull().default("0"),
		outputTokens: decimal().notNull().default("0"),
		totalTokens: decimal().notNull().default("0"),
		reasoningTokens: decimal().notNull().default("0"),
		cachedTokens: decimal().notNull().default("0"),
		// Costs
		cost: real().notNull().default(0),
		inputCost: real().notNull().default(0),
		outputCost: real().notNull().default(0),
		requestCost: real().notNull().default(0),
		dataStorageCost: real().notNull().default(0),
		discountSavings: real().notNull().default(0),
		imageInputCost: real().notNull().default(0),
		imageOutputCost: real().notNull().default(0),
		cachedInputCost: real().notNull().default(0),
		// Per-mode breakdowns
		creditsRequestCount: integer().notNull().default(0),
		apiKeysRequestCount: integer().notNull().default(0),
		creditsCost: real().notNull().default(0),
		apiKeysCost: real().notNull().default(0),
		creditsDataStorageCost: real().notNull().default(0),
		apiKeysDataStorageCost: real().notNull().default(0),
	},
	(table) => [
		// Unique constraint for one record per project-hour (also creates implicit index)
		unique().on(table.projectId, table.hourTimestamp),
		// Index for worker refresh queries (find hours to update)
		index("project_hourly_stats_hour_timestamp_idx").on(table.hourTimestamp),
	],
);

// Project hourly model statistics aggregation - model breakdown per hour
export const projectHourlyModelStats = pgTable(
	"project_hourly_model_stats",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		projectId: text().notNull(),
		hourTimestamp: timestamp().notNull(), // Start of the hour bucket
		usedModel: text().notNull(),
		usedProvider: text().notNull(),
		// Request counts
		requestCount: integer().notNull().default(0),
		errorCount: integer().notNull().default(0),
		cacheCount: integer().notNull().default(0),
		streamedCount: integer().notNull().default(0),
		nonStreamedCount: integer().notNull().default(0),
		// Unified finish reason counts
		completedCount: integer().notNull().default(0),
		lengthLimitCount: integer().notNull().default(0),
		contentFilterCount: integer().notNull().default(0),
		toolCallsCount: integer().notNull().default(0),
		canceledCount: integer().notNull().default(0),
		unknownFinishCount: integer().notNull().default(0),
		// Error type counts (subset of errorCount)
		clientErrorCount: integer().notNull().default(0),
		gatewayErrorCount: integer().notNull().default(0),
		upstreamErrorCount: integer().notNull().default(0),
		// Token counts
		inputTokens: decimal().notNull().default("0"),
		outputTokens: decimal().notNull().default("0"),
		totalTokens: decimal().notNull().default("0"),
		reasoningTokens: decimal().notNull().default("0"),
		cachedTokens: decimal().notNull().default("0"),
		// Costs
		cost: real().notNull().default(0),
		inputCost: real().notNull().default(0),
		outputCost: real().notNull().default(0),
		requestCost: real().notNull().default(0),
		dataStorageCost: real().notNull().default(0),
		discountSavings: real().notNull().default(0),
		imageInputCost: real().notNull().default(0),
		imageOutputCost: real().notNull().default(0),
		cachedInputCost: real().notNull().default(0),
		// Per-mode breakdowns
		creditsRequestCount: integer().notNull().default(0),
		apiKeysRequestCount: integer().notNull().default(0),
		creditsCost: real().notNull().default(0),
		apiKeysCost: real().notNull().default(0),
		creditsDataStorageCost: real().notNull().default(0),
		apiKeysDataStorageCost: real().notNull().default(0),
	},
	(table) => [
		// Unique constraint for one record per project-hour-model-provider
		unique().on(
			table.projectId,
			table.hourTimestamp,
			table.usedModel,
			table.usedProvider,
		),
		// Index for dashboard queries (project + time range)
		index("project_hourly_model_stats_project_id_hour_timestamp_idx").on(
			table.projectId,
			table.hourTimestamp,
		),
		// Index for worker refresh queries
		index("project_hourly_model_stats_hour_timestamp_idx").on(
			table.hourTimestamp,
		),
	],
);

// API key hourly statistics aggregation - for per-key breakdown queries
export const apiKeyHourlyStats = pgTable(
	"api_key_hourly_stats",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		apiKeyId: text().notNull(),
		projectId: text().notNull(), // Denormalized for efficient queries
		hourTimestamp: timestamp().notNull(), // Start of the hour bucket
		// Request counts
		requestCount: integer().notNull().default(0),
		errorCount: integer().notNull().default(0),
		cacheCount: integer().notNull().default(0),
		streamedCount: integer().notNull().default(0),
		nonStreamedCount: integer().notNull().default(0),
		// Unified finish reason counts
		completedCount: integer().notNull().default(0),
		lengthLimitCount: integer().notNull().default(0),
		contentFilterCount: integer().notNull().default(0),
		toolCallsCount: integer().notNull().default(0),
		canceledCount: integer().notNull().default(0),
		unknownFinishCount: integer().notNull().default(0),
		// Error type counts (subset of errorCount)
		clientErrorCount: integer().notNull().default(0),
		gatewayErrorCount: integer().notNull().default(0),
		upstreamErrorCount: integer().notNull().default(0),
		// Token counts
		inputTokens: decimal().notNull().default("0"),
		outputTokens: decimal().notNull().default("0"),
		totalTokens: decimal().notNull().default("0"),
		reasoningTokens: decimal().notNull().default("0"),
		cachedTokens: decimal().notNull().default("0"),
		// Costs
		cost: real().notNull().default(0),
		inputCost: real().notNull().default(0),
		outputCost: real().notNull().default(0),
		requestCost: real().notNull().default(0),
		dataStorageCost: real().notNull().default(0),
		discountSavings: real().notNull().default(0),
		imageInputCost: real().notNull().default(0),
		imageOutputCost: real().notNull().default(0),
		cachedInputCost: real().notNull().default(0),
		// Per-mode breakdowns
		creditsRequestCount: integer().notNull().default(0),
		apiKeysRequestCount: integer().notNull().default(0),
		creditsCost: real().notNull().default(0),
		apiKeysCost: real().notNull().default(0),
		creditsDataStorageCost: real().notNull().default(0),
		apiKeysDataStorageCost: real().notNull().default(0),
	},
	(table) => [
		// Unique constraint for one record per api-key-hour
		unique().on(table.apiKeyId, table.hourTimestamp),
		// Index for dashboard queries (api key + time range)
		index("api_key_hourly_stats_api_key_id_hour_timestamp_idx").on(
			table.apiKeyId,
			table.hourTimestamp,
		),
		// Index for project-level queries (all keys in a project)
		index("api_key_hourly_stats_project_id_hour_timestamp_idx").on(
			table.projectId,
			table.hourTimestamp,
		),
		// Index for worker refresh queries
		index("api_key_hourly_stats_hour_timestamp_idx").on(table.hourTimestamp),
	],
);

// API key hourly model statistics aggregation - model breakdown per API key per hour
export const apiKeyHourlyModelStats = pgTable(
	"api_key_hourly_model_stats",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		apiKeyId: text().notNull(),
		projectId: text().notNull(), // Denormalized for efficient queries
		hourTimestamp: timestamp().notNull(), // Start of the hour bucket
		usedModel: text().notNull(),
		usedProvider: text().notNull(),
		// Request counts
		requestCount: integer().notNull().default(0),
		errorCount: integer().notNull().default(0),
		cacheCount: integer().notNull().default(0),
		streamedCount: integer().notNull().default(0),
		nonStreamedCount: integer().notNull().default(0),
		// Unified finish reason counts
		completedCount: integer().notNull().default(0),
		lengthLimitCount: integer().notNull().default(0),
		contentFilterCount: integer().notNull().default(0),
		toolCallsCount: integer().notNull().default(0),
		canceledCount: integer().notNull().default(0),
		unknownFinishCount: integer().notNull().default(0),
		// Error type counts (subset of errorCount)
		clientErrorCount: integer().notNull().default(0),
		gatewayErrorCount: integer().notNull().default(0),
		upstreamErrorCount: integer().notNull().default(0),
		// Token counts
		inputTokens: decimal().notNull().default("0"),
		outputTokens: decimal().notNull().default("0"),
		totalTokens: decimal().notNull().default("0"),
		reasoningTokens: decimal().notNull().default("0"),
		cachedTokens: decimal().notNull().default("0"),
		// Costs
		cost: real().notNull().default(0),
		inputCost: real().notNull().default(0),
		outputCost: real().notNull().default(0),
		requestCost: real().notNull().default(0),
		dataStorageCost: real().notNull().default(0),
		discountSavings: real().notNull().default(0),
		imageInputCost: real().notNull().default(0),
		imageOutputCost: real().notNull().default(0),
		cachedInputCost: real().notNull().default(0),
		// Per-mode breakdowns
		creditsRequestCount: integer().notNull().default(0),
		apiKeysRequestCount: integer().notNull().default(0),
		creditsCost: real().notNull().default(0),
		apiKeysCost: real().notNull().default(0),
		creditsDataStorageCost: real().notNull().default(0),
		apiKeysDataStorageCost: real().notNull().default(0),
	},
	(table) => [
		// Unique constraint for one record per api-key-hour-model-provider
		unique().on(
			table.apiKeyId,
			table.hourTimestamp,
			table.usedModel,
			table.usedProvider,
		),
		// Index for dashboard queries (api key + time range)
		index("api_key_hourly_model_stats_api_key_id_hour_timestamp_idx").on(
			table.apiKeyId,
			table.hourTimestamp,
		),
		// Index for project-level queries (all keys in a project)
		index("api_key_hourly_model_stats_project_id_hour_timestamp_idx").on(
			table.projectId,
			table.hourTimestamp,
		),
		// Index for worker refresh queries
		index("api_key_hourly_model_stats_hour_timestamp_idx").on(
			table.hourTimestamp,
		),
	],
);
