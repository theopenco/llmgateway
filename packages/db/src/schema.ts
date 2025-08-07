import {
	boolean,
	decimal,
	integer,
	json,
	pgTable,
	real,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";
import { customAlphabet } from "nanoid";

import type { errorDetails, tools, toolChoice, toolResults } from "./types";
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

export const session = pgTable("session", {
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
});

export const account = pgTable("account", {
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
});

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

export const transaction = pgTable("transaction", {
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
});

export const userOrganization = pgTable("user_organization", {
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
});

export const project = pgTable("project", {
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
});

export const apiKey = pgTable("api_key", {
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
});

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
		status: text({
			enum: ["active", "inactive", "deleted"],
		}).default("active"),
		organizationId: text()
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
	},
	(table) => [unique().on(table.organizationId, table.name)],
);

export const log = pgTable("log", {
	id: text().primaryKey().notNull().$defaultFn(shortid),
	requestId: text().notNull(),
	createdAt: timestamp().notNull().defaultNow(),
	updatedAt: timestamp()
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
	organizationId: text()
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
	projectId: text()
		.notNull()
		.references(() => project.id, { onDelete: "cascade" }),
	apiKeyId: text()
		.notNull()
		.references(() => apiKey.id, { onDelete: "cascade" }),
	duration: integer().notNull(),
	requestedModel: text().notNull(),
	requestedProvider: text(),
	usedModel: text().notNull(),
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
	hasError: boolean().default(false),
	errorDetails: json().$type<z.infer<typeof errorDetails>>(),
	cost: real(),
	inputCost: real(),
	outputCost: real(),
	cachedInputCost: real(),
	requestCost: real(),
	estimatedCost: boolean().default(false),
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
});

export const passkey = pgTable("passkey", {
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
});

export const paymentMethod = pgTable("payment_method", {
	id: text().primaryKey().$defaultFn(shortid),
	createdAt: timestamp().notNull().defaultNow(),
	updatedAt: timestamp().notNull().defaultNow(),
	stripePaymentMethodId: text().notNull(),
	organizationId: text()
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
	type: text().notNull(), // "card", "sepa_debit", etc.
	isDefault: boolean().notNull().default(false),
});

export const organizationAction = pgTable("organization_action", {
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
});

export const lock = pgTable("lock", {
	id: text().primaryKey().$defaultFn(shortid),
	createdAt: timestamp().notNull().defaultNow(),
	updatedAt: timestamp()
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
	key: text().notNull().unique(),
});

export const chat = pgTable("chat", {
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
});

export const message = pgTable("message", {
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
	content: text().notNull(),
	sequence: integer().notNull(), // To maintain message order
});

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
