import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	check,
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
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { customAlphabet } from "nanoid";

import type { gatewayContentFilterResponseSchema } from "./log-payloads.js";
import type { errorDetails, tools, toolChoice, toolResults } from "./types.js";
import type { ProviderCompliancePolicy } from "@llmgateway/models";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
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
	newsletterSubscribed: boolean().notNull().default(false),
	status: text({
		enum: ["active", "deactivated"],
	})
		.notNull()
		.default("active"),
	// DevPass public profile. `username` is the public URL slug
	// (/profiles/:username) and is null until the user claims one.
	username: text().unique(),
	profilePublic: boolean().notNull().default(false),
	bio: text(),
	githubUsername: text(),
	xUsername: text(),
});

export const userFavoriteModel = pgTable(
	"user_favorite_model",
	{
		id: text().primaryKey().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		modelId: text().notNull(),
	},
	(table) => [
		uniqueIndex("user_favorite_model_user_id_model_id_unique").on(
			table.userId,
			table.modelId,
		),
	],
);

export const modelRating = pgTable(
	"model_rating",
	{
		id: text().primaryKey().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		modelId: text().notNull(),
		rating: integer().notNull(),
		comment: text(),
	},
	(table) => [
		uniqueIndex("model_rating_user_id_model_id_unique").on(
			table.userId,
			table.modelId,
		),
		index("model_rating_model_id_idx").on(table.modelId),
		check(
			"model_rating_rating_check",
			sql`${table.rating} >= 1 AND ${table.rating} <= 5`,
		),
	],
);

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

export const organization = pgTable(
	"organization",
	{
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
		// Enterprise provider compliance guardrails. When enabled, the gateway
		// only routes to providers meeting the required certifications/data
		// policies. Null = no policy configured.
		providerCompliancePolicy: json().$type<ProviderCompliancePolicy>(),
		status: text({
			enum: ["active", "inactive", "deleted"],
		}).default("active"),
		referralEarnings: decimal().notNull().default("0"),
		// When enabled, organizations referred by this org receive a bonus on
		// their first credit top-up. Configurable only via the admin dashboard.
		referralBonusEnabled: boolean().notNull().default(false),
		// Percentage bonus applied to the referred org's first top-up (e.g. 50 = 50%).
		referralBonusPercent: decimal().notNull().default("50"),
		paymentFailureCount: integer().notNull().default(0),
		lastPaymentFailureAt: timestamp(),
		paymentFailureStartedAt: timestamp(),
		// Organization kind:
		// - "default": regular dashboard/team org.
		// - "devpass": per-user personal org backing the Dev Plans (DevPass) product.
		// - "chat": dedicated per-user "Chat" org backing chat.llmgateway.io.
		// "devpass" and "chat" orgs are hidden from the dashboard org switcher and
		// cannot be deleted or managed as team orgs.
		kind: text({
			enum: ["default", "chat", "devpass"],
		})
			.notNull()
			.default("default"),
		devPlan: text({
			enum: ["none", "lite", "pro", "max"],
		})
			.notNull()
			.default("none"),
		devPlanCreditsUsed: decimal().notNull().default("0"),
		devPlanCreditsLimit: decimal().notNull().default("0"),
		devPlanPremiumCreditsUsed: decimal().notNull().default("0"),
		devPlanPremiumWeekStart: timestamp(),
		// Set when dunning freezes dev-plan spend (limit capped to used). The
		// pre-freeze limit is preserved so recovery restores the exact value
		// (which may be a prorated mid-cycle amount), not a full tier cap.
		devPlanCreditsFrozen: boolean().notNull().default(false),
		devPlanCreditsLimitBeforeFreeze: decimal(),
		devPlanBillingCycleStart: timestamp(),
		// Stripe current_period_start of the cycle in which the last tier change
		// was claimed. A tier change atomically advances this to the current cycle
		// start only if it hasn't been claimed yet, enforcing one change per cycle
		// without a read-then-write race.
		devPlanLastTierChangeCycleStart: timestamp(),
		devPlanStripeSubscriptionId: text().unique(),
		devPlanCancelled: boolean().notNull().default(false),
		devPlanExpiresAt: timestamp(),
		// A scheduled downgrade to a lower tier. Downgrades apply at the next
		// renewal, so `devPlan` (and the current cycle's credits) stay on the
		// higher tier until then; this holds the tier the subscription will move
		// to at renewal. Null means no pending downgrade. The renewal webhook
		// applies it and clears it. Upgrades take effect immediately and never set
		// this.
		devPlanPendingTier: text({ enum: ["lite", "pro", "max"] }),
		devPlanCycle: text({ enum: ["monthly", "annual"] })
			.notNull()
			.default("monthly"),
		devPlanAllowAllModels: boolean().notNull().default(false),
		// When false (default), DevPass invoices use the owner's default-org
		// billing details. When true, the DevPass org's own billing* fields below
		// are used as a custom override for DevPass invoices.
		devPlanBillingOverride: boolean().notNull().default(false),
		// Fingerprint of the card used to subscribe to a dev plan. Used to
		// prevent a single card from claiming the DevPass usage allowance from
		// multiple personal organizations.
		devPlanCardFingerprint: text(),
		// Chat Plans fields (for chat.llmgateway.io subscribers)
		chatPlan: text({
			enum: ["none", "starter", "plus", "pro"],
		})
			.notNull()
			.default("none"),
		chatPlanCreditsUsed: decimal().notNull().default("0"),
		chatPlanCreditsLimit: decimal().notNull().default("0"),
		chatPlanBillingCycleStart: timestamp(),
		chatPlanStripeSubscriptionId: text().unique(),
		chatPlanCancelled: boolean().notNull().default(false),
		chatPlanExpiresAt: timestamp(),
		chatPlanCycle: text({ enum: ["monthly"] })
			.notNull()
			.default("monthly"),
		// Same one-card-one-org policy as dev plans.
		chatPlanCardFingerprint: text(),
		// Last top-up amount (used for low balance alert thresholds)
		lastTopUpAmount: decimal(),
		// Accrued developer margin from end-user credit top-ups (embeddable SDK).
		// Internal liability tracked here; paid out to the developer's connected
		// Stripe account via Stripe Connect transfers.
		endUserMarginBalance: decimal().notNull().default("0"),
		// The developer's connected Stripe account (Express) used to pay out their
		// accrued end-user margin. Null until they onboard.
		stripeConnectAccountId: text().unique(),
		stripeConnectOnboarded: boolean().notNull().default(false),
		// Org-wide default budget applied to every "developer" member. A member's
		// own per-member budget (on user_organization) overrides these field by
		// field. null = no default. Same shape as the per-member budget.
		defaultDeveloperMaxApiKeys: integer(),
		defaultDeveloperUsageLimit: decimal(),
		defaultDeveloperPeriodUsageLimit: decimal(),
		defaultDeveloperPeriodUsageDurationValue: integer(),
		defaultDeveloperPeriodUsageDurationUnit: text({
			enum: ["hour", "day", "week", "month"],
		}),
	},
	(table) => [
		index("organization_dev_plan_card_fingerprint_idx").on(
			table.devPlanCardFingerprint,
		),
		// Unique so the one-card-one-org rule holds even if concurrent webhook
		// handlers race past the application-level dedupe check. NULLs (orgs
		// without a chat plan) are distinct in Postgres, so this only constrains
		// active fingerprints.
		uniqueIndex("organization_chat_plan_card_fingerprint_uidx").on(
			table.chatPlanCardFingerprint,
		),
	],
);

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
				"chat_plan_start",
				"chat_plan_upgrade",
				"chat_plan_downgrade",
				"chat_plan_cancel",
				"chat_plan_end",
				"chat_plan_renewal",
				// LLM SDK end-user wallet flows.
				"end_user_topup",
				"end_user_margin_accrual",
				"end_user_refund",
				"end_user_margin_payout",
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
		stripeRefundId: text(),
		description: text(),
		relatedTransactionId: text(),
		refundReason: text(),
	},
	(table) => [
		index("transaction_organization_id_idx").on(table.organizationId),
		uniqueIndex("transaction_stripe_refund_id_unique")
			.on(table.stripeRefundId)
			.where(sql`${table.stripeRefundId} IS NOT NULL`),
		uniqueIndex("transaction_stripe_invoice_id_unique")
			.on(table.stripeInvoiceId)
			.where(sql`${table.stripeInvoiceId} IS NOT NULL`),
	],
);

export const devPlanCancellationFeedback = pgTable(
	"dev_plan_cancellation_feedback",
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
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		devPlanStripeSubscriptionId: text().notNull(),
		previousDevPlan: text({
			enum: ["lite", "pro", "max"],
		}),
		reason: text({
			enum: [
				"too_expensive",
				"missing_features",
				"not_using_enough",
				"switched_alternative",
				"other",
			],
		}).notNull(),
		comments: text(),
	},
	(table) => [
		uniqueIndex("dev_plan_cancellation_feedback_org_sub_unique").on(
			table.organizationId,
			table.devPlanStripeSubscriptionId,
		),
		index("dev_plan_cancellation_feedback_organization_id_idx").on(
			table.organizationId,
		),
	],
);

export const chatPlanCancellationFeedback = pgTable(
	"chat_plan_cancellation_feedback",
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
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		chatPlanStripeSubscriptionId: text().notNull(),
		previousChatPlan: text({
			enum: ["starter", "plus", "pro"],
		}),
		reason: text({
			enum: [
				"too_expensive",
				"missing_features",
				"not_using_enough",
				"switched_alternative",
				"other",
			],
		}).notNull(),
		comments: text(),
	},
	(table) => [
		uniqueIndex("chat_plan_cancellation_feedback_org_sub_unique").on(
			table.organizationId,
			table.chatPlanStripeSubscriptionId,
		),
		index("chat_plan_cancellation_feedback_organization_id_idx").on(
			table.organizationId,
		),
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
			enum: [
				"no_purchase",
				"low_usage",
				"no_repurchase",
				"low_balance_20",
				"low_balance_5",
			],
		}).notNull(),
		sentTo: text().notNull(),
	},
	(table) => [
		unique().on(table.organizationId, table.emailType),
		index("follow_up_email_organization_id_idx").on(table.organizationId),
	],
);

export const paymentFailure = pgTable(
	"payment_failure",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		organizationId: text()
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userEmail: text(),
		amount: decimal(),
		currency: text().notNull().default("USD"),
		declineCode: text(),
		errorCode: text(),
		failureMessage: text(),
		stripePaymentIntentId: text(),
		source: text(), // "auto_topup" | "manual" | "checkout"
	},
	(table) => [
		index("payment_failure_organization_id_idx").on(table.organizationId),
		index("payment_failure_created_at_idx").on(table.createdAt),
		index("payment_failure_decline_code_idx").on(table.declineCode),
		unique("payment_failure_stripe_pi_idx").on(table.stripePaymentIntentId),
	],
);

export const enterpriseContactSubmission = pgTable(
	"enterprise_contact_submission",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		name: text().notNull(),
		email: text().notNull(),
		country: text().notNull(),
		size: text().notNull(),
		deployment: text({
			enum: ["self_host", "cloud", "not_sure"],
		}),
		message: text().notNull(),
		honeypot: text(),
		clientTimestampMs: text(),
		ipAddress: text(),
		userAgent: text(),
		spamFilterStatus: text({
			enum: ["pending", "rejected", "delivered", "delivery_failed"],
		})
			.notNull()
			.default("pending"),
		rejectionReason: text(),
		archivedAt: timestamp(),
	},
	(table) => [
		index("enterprise_contact_submission_created_at_idx").on(table.createdAt),
		index("enterprise_contact_submission_email_idx").on(table.email),
		index("enterprise_contact_submission_status_idx").on(
			table.spamFilterStatus,
		),
		check(
			"enterprise_contact_submission_deployment_check",
			sql`${table.deployment} IS NULL OR ${table.deployment} IN ('self_host', 'cloud', 'not_sure')`,
		),
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
		// Per-member budgets (config only; spend is read from existing per-key
		// sources — apiKey.usage and apiKeyHourlyStats.cost — so no counters here).
		// null = unlimited.
		maxApiKeys: integer(),
		usageLimit: decimal(),
		periodUsageLimit: decimal(),
		periodUsageDurationValue: integer(),
		periodUsageDurationUnit: text({
			enum: ["hour", "day", "week", "month"],
		}),
	},
	(table) => [
		index("user_organization_user_id_idx").on(table.userId),
		index("user_organization_organization_id_idx").on(table.organizationId),
	],
);

// Project-level access grants for project-scoped members. Owners/admins have
// implicit access to every project in their org (no rows here); "developer"
// members are limited to the projects granted via this table. Keyed on the
// membership so grants cascade-delete when a member is removed from the org.
export const userProject = pgTable(
	"user_project",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		userOrganizationId: text()
			.notNull()
			.references(() => userOrganization.id, { onDelete: "cascade" }),
		projectId: text()
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("user_project_membership_project_unique").on(
			table.userOrganizationId,
			table.projectId,
		),
		index("user_project_user_organization_id_idx").on(table.userOrganizationId),
		index("user_project_project_id_idx").on(table.projectId),
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
		providerCacheControlEnabled: boolean().notNull().default(true),
		mode: text({
			enum: ["api-keys", "credits", "hybrid"],
		})
			.notNull()
			.default("hybrid"),
		// Default smart-routing strategy applied when a request omits the
		// `routing` field. Named after the factor it optimizes; "auto" uses the
		// full weighted score.
		defaultRoutingStrategy: text({
			enum: ["auto", "price", "throughput", "latency"],
		})
			.notNull()
			.default("auto"),
		status: text({
			enum: ["active", "inactive", "deleted"],
		}).default("active"),
		// Payments SDK (embeddable end-user payments) is a preview feature that is
		// opt-in only: it can be granted per project directly in the database. When
		// false, the dashboard shows a read-only preview and the end-user settings
		// below cannot be enabled through the API.
		paymentsSdkEnabled: boolean().notNull().default(false),
		// Embeddable end-user SDK: gates whether this project may mint end-user
		// sessions / wallets at all.
		endUserEnabled: boolean().notNull().default(false),
		// Developer markup applied to end-user credit top-ups (e.g. "20" = +20%).
		// Baked into credited spend power at top-up time so the usage/debit path
		// stays raw-cost. Overridable per-wallet via wallet.markupPercentOverride.
		endUserMarkupPercent: decimal().notNull().default("0"),
		// Browser origins allowed to call the gateway with this project's
		// ephemeral end-user session tokens (CORS allowlist).
		allowedOrigins: json().$type<string[]>(),
	},
	(table) => [index("project_organization_id_idx").on(table.organizationId)],
);

// The developer's own end-users (the "customers" in the embeddable SDK). Scoped
// to one project; `externalId` is the developer's own user id in their system.
export const endCustomer = pgTable(
	"end_customer",
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
		projectId: text()
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		externalId: text().notNull(),
		email: text(),
		name: text(),
		// `test` end-customers belong to a developer's Stripe-sandbox (test-mode
		// secret key) and are fully segregated from `live` ones, so the same
		// externalId can have an independent test and live wallet.
		mode: text({ enum: ["live", "test"] })
			.notNull()
			.default("live"),
		// Each end-customer is the merchant-of-record customer for their own
		// top-ups (separate Stripe customer from the developer's org).
		stripeCustomerId: text().unique(),
		metadata: json().$type<Record<string, unknown>>(),
		status: text({
			enum: ["active", "blocked", "deleted"],
		})
			.notNull()
			.default("active"),
	},
	(table) => [
		uniqueIndex("end_customer_project_id_external_id_unique").on(
			table.projectId,
			table.externalId,
			table.mode,
		),
		index("end_customer_organization_id_idx").on(table.organizationId),
		index("end_customer_project_id_idx").on(table.projectId),
	],
);

// Per-end-customer credit wallet. Has its OWN balance column (not
// organization.credits) so refunds/ledgers are isolated per end-user. Balance
// holds real USD spend power (markup already applied at top-up), so the gateway
// debits raw provider cost with no per-request markup math. 1:1 with
// end_customer for v1.
export const wallet = pgTable(
	"wallet",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		endCustomerId: text()
			.notNull()
			.unique()
			.references(() => endCustomer.id, { onDelete: "cascade" }),
		projectId: text()
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		// Denormalized for fast worker debit + developer settlement.
		organizationId: text()
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		// Denormalized from end_customer for fast gateway gating: `test` wallets are
		// funded by Stripe-sandbox top-ups, so the gateway only lets them spend on
		// free models and the top-up webhook never accrues real developer margin.
		mode: text({ enum: ["live", "test"] })
			.notNull()
			.default("live"),
		balance: decimal().notNull().default("0"),
		currency: text().notNull().default("USD"),
		// Optional per-wallet markup override; falls back to project.endUserMarkupPercent.
		markupPercentOverride: decimal(),
		// Optional safety ceiling on a single session's spend.
		spendCapPerSession: decimal(),
		status: text({
			enum: ["active", "frozen"],
		})
			.notNull()
			.default("active"),
	},
	(table) => [
		index("wallet_organization_id_idx").on(table.organizationId),
		index("wallet_project_id_idx").on(table.projectId),
	],
);

export const endUserSession = pgTable(
	"end_user_session",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		token: text().notNull().unique(),
		status: text({
			enum: ["active", "inactive", "deleted"],
		})
			.notNull()
			.default("active"),
		expiresAt: timestamp().notNull(),
		organizationId: text()
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		projectId: text()
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		endCustomerId: text()
			.notNull()
			.references(() => endCustomer.id, { onDelete: "cascade" }),
		walletId: text()
			.notNull()
			.references(() => wallet.id, { onDelete: "cascade" }),
		createdBy: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		scope: json().$type<{ models?: string[] }>(),
		usageLimit: decimal(),
		usage: decimal().notNull().default("0"),
		periodUsageLimit: decimal(),
		periodUsageDurationValue: integer(),
		periodUsageDurationUnit: text({
			enum: ["hour", "day", "week", "month"],
		}),
		currentPeriodUsage: decimal().notNull().default("0"),
		currentPeriodStartedAt: timestamp(),
	},
	(table) => [
		index("end_user_session_project_id_idx").on(table.projectId),
		index("end_user_session_wallet_id_idx").on(table.walletId),
		index("end_user_session_status_expires_at_idx").on(
			table.status,
			table.expiresAt,
		),
	],
);

// Append-only ledger for every wallet movement. `topup` rows carry the economic
// split (grossPaid = what the end-user paid Stripe, platformFee = llmgateway
// cut, developerMargin = markup accrued to the developer org, netCredited = what
// landed in wallet.balance). `usage_debit` rows link back to the gateway log via
// gatewayLogId (soft reference — log rows are retention-cleaned).
export const walletLedger = pgTable(
	"wallet_ledger",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		walletId: text()
			.notNull()
			.references(() => wallet.id, { onDelete: "cascade" }),
		endCustomerId: text()
			.notNull()
			.references(() => endCustomer.id, { onDelete: "cascade" }),
		organizationId: text()
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		type: text({
			enum: ["topup", "usage_debit", "refund", "adjustment", "reversal"],
		}).notNull(),
		// Signed amount in wallet currency (post-markup): +topup, -usage_debit.
		amount: decimal().notNull(),
		balanceAfter: decimal().notNull(),
		// Economic split, populated on topup/refund rows (all in USD):
		grossPaid: decimal(),
		platformFee: decimal(),
		developerMargin: decimal(),
		netCredited: decimal(),
		stripePaymentIntentId: text(),
		gatewayLogId: text(),
		description: text(),
	},
	(table) => [
		index("wallet_ledger_wallet_id_idx").on(table.walletId),
		index("wallet_ledger_organization_id_idx").on(table.organizationId),
		index("wallet_ledger_stripe_payment_intent_id_idx").on(
			table.stripePaymentIntentId,
		),
		// Idempotency guard: at most one topup row per PaymentIntent, so concurrent
		// webhook deliveries can't double-credit a wallet (enforced at the DB layer).
		uniqueIndex("wallet_ledger_topup_payment_intent_unique")
			.on(table.stripePaymentIntentId)
			.where(sql`${table.type} = 'topup'`),
		// Idempotency guard: at most one reversal row per PaymentIntent, so
		// concurrent / re-delivered charge.refunded webhooks can't double-reverse a
		// wallet (debit twice + claw back margin twice).
		uniqueIndex("wallet_ledger_reversal_payment_intent_unique")
			.on(table.stripePaymentIntentId)
			.where(sql`${table.type} = 'reversal'`),
	],
);

// LLM SDK: a developer's registered webhook endpoint. LLM Gateway POSTs
// signed events (wallet.credited, wallet.low_balance, …) here so the developer's
// backend can react. The signing secret is shown once at creation.
export const webhookEndpoint = pgTable(
	"webhook_endpoint",
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
		projectId: text()
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		url: text().notNull(),
		/** HMAC signing secret (`whsec_…`). */
		secret: text().notNull(),
		/** Subscribed event types; null = all events. */
		enabledEvents: json().$type<string[]>(),
		status: text({ enum: ["active", "disabled"] })
			.notNull()
			.default("active"),
	},
	(table) => [
		index("webhook_endpoint_project_id_idx").on(table.projectId),
		index("webhook_endpoint_organization_id_idx").on(table.organizationId),
	],
);

// One queued delivery of an event to one endpoint, retried with backoff.
export const platformWebhookDelivery = pgTable(
	"platform_webhook_delivery",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		webhookEndpointId: text()
			.notNull()
			.references(() => webhookEndpoint.id, { onDelete: "cascade" }),
		eventId: text().notNull(),
		eventType: text().notNull(),
		payload: jsonb().$type<Record<string, unknown>>().notNull(),
		status: text({ enum: ["pending", "delivered", "failed"] })
			.notNull()
			.default("pending"),
		attempts: integer().notNull().default(0),
		nextAttemptAt: timestamp().notNull().defaultNow(),
		lastAttemptAt: timestamp(),
		responseStatus: integer(),
		lastError: text(),
	},
	(table) => [
		// Delivery worker poll: WHERE status = 'pending' AND next_attempt_at <= now().
		index("platform_webhook_delivery_status_next_attempt_idx")
			.on(table.status, table.nextAttemptAt)
			.where(sql`status = 'pending'`),
		index("platform_webhook_delivery_endpoint_id_idx").on(
			table.webhookEndpointId,
		),
	],
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
		// Discriminates normal developer keys from embeddable-SDK principals.
		// `platform_secret`/`platform_publishable` are long-lived keys on a hidden
		// per-org project. `end_user_customer` is a hidden per-customer aggregate
		// key used as the stable log/api-key stats principal for browser sessions.
		keyType: text({
			enum: [
				"user",
				"platform_secret",
				"platform_publishable",
				"end_user_customer",
			],
		})
			.notNull()
			.default("user"),
		// Browser-session wallet binding now lives on end_user_session.wallet_id.
		endCustomerWalletId: text().references(() => wallet.id, {
			onDelete: "cascade",
		}),
		// Platform keys may be long-lived; browser-session expiry now lives on
		// end_user_session.expires_at.
		expiresAt: timestamp(),
		usageLimit: decimal(),
		usage: decimal().notNull().default("0"),
		periodUsageLimit: decimal(),
		periodUsageDurationValue: integer(),
		periodUsageDurationUnit: text({
			enum: ["hour", "day", "week", "month"],
		}),
		currentPeriodUsage: decimal().notNull().default("0"),
		currentPeriodStartedAt: timestamp(),
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
		index("api_key_key_type_expires_at_idx").on(table.keyType, table.expiresAt),
		uniqueIndex("api_key_end_user_customer_wallet_unique")
			.on(table.endCustomerWalletId)
			.where(
				sql`${table.keyType} = 'end_user_customer' AND ${table.status} = 'active'`,
			),
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
				"allow_ip_cidrs",
				"deny_ip_cidrs",
			],
		}).notNull(),
		ruleValue: json()
			.$type<{
				models?: string[];
				providers?: string[];
				pricingType?: "free" | "paid";
				maxInputPrice?: number;
				maxOutputPrice?: number;
				ipCidrs?: string[];
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

export const masterKey = pgTable(
	"master_key",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		tokenHash: text().notNull().unique(),
		maskedToken: text().notNull(),
		description: text().notNull(),
		status: text({
			enum: ["active", "inactive", "deleted"],
		}).default("active"),
		lastUsedAt: timestamp(),
		organizationId: text()
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		createdBy: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("master_key_organization_id_idx").on(table.organizationId),
		index("master_key_token_hash_idx").on(table.tokenHash),
		index("master_key_created_by_idx").on(table.createdBy),
	],
);

export interface ProviderKeyOptions {
	aws_bedrock_region_prefix?: "us." | "global." | "eu." | "apac.";
	aws_bedrock_region?:
		| "global"
		| "us"
		| "eu"
		| "apac"
		| "us-east-1"
		| "us-east-2"
		| "us-west-2"
		| "eu-central-1"
		| "eu-west-1"
		| "ap-northeast-1"
		| "ap-southeast-1"
		| "ap-southeast-2";
	azure_resource?: string;
	azure_api_version?: string;
	azure_deployment_type?: "openai" | "ai-foundry";
	azure_validation_model?: string;
	azure_deployment_name?: string;
	azure_ai_foundry_resource?: string;
	azure_ai_foundry_api_version?: string;
	alibaba_region?: "singapore" | "us-virginia" | "cn-beijing";
	google_vertex_project_id?: string;
	google_vertex_token_type?: "api-key" | "oauth";
	vertex_openai_project_id?: string;
	vertex_openai_region?: "global";
	vertex_anthropic_region?: string;
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
		name: text(), // Optional name for custom providers (lowercase a-z with single hyphens)
		baseUrl: text(), // Optional base URL for custom providers
		options: jsonb().$type<ProviderKeyOptions>(),
		// When true (custom providers only), requests through this key are
		// restricted to models defined in its custom model catalog.
		customModelsOnly: boolean().notNull().default(false),
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

// Per-provider-key catalog of custom models. Enterprise orgs define these to
// attribute cost and enforce context/output limits for custom-provider
// requests. All pricing/limit/capability fields are optional; prices are stored
// as text to preserve the catalog's exponent-string format (e.g. "3.0e-6").
export const customModel = pgTable(
	"custom_model",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		providerKeyId: text()
			.notNull()
			.references(() => providerKey.id, { onDelete: "cascade" }),
		organizationId: text()
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		// The model id used after the provider prefix (e.g. "gpt-5.5").
		modelName: text().notNull(),
		displayName: text(),
		contextSize: integer(),
		maxOutput: integer(),
		inputPrice: text(),
		outputPrice: text(),
		cachedInputPrice: text(),
		cacheReadInputPrice: text(),
		cacheWriteInputPrice: text(),
		cacheWriteInputPrice1h: text(),
		requestPrice: text(),
		webSearchPrice: text(),
		// Custom models are text-output only. Multi-modal *input* (image/audio)
		// is still supported and priced via the input fields above; output
		// generation pricing (image/video/audio out) is intentionally omitted
		// because it is too provider-specific to bill generically.
		imageInputPrice: text(),
		audioInputPrice: text(),
		streaming: text({ enum: ["true", "false", "only"] }),
		vision: boolean(),
		tools: boolean(),
		reasoning: boolean(),
		jsonOutput: boolean(),
		audio: boolean(),
		supportedParameters: jsonb().$type<string[]>(),
		status: text({
			enum: ["active", "inactive", "deleted"],
		})
			.notNull()
			.default("active"),
	},
	(table) => [
		// Uniqueness applies only to live rows so a soft-deleted model name can be
		// recreated (the route soft-deletes by setting status = "deleted").
		uniqueIndex("custom_model_provider_key_id_model_name_unique")
			.on(table.providerKeyId, table.modelName)
			.where(sql`status <> 'deleted'`),
		index("custom_model_provider_key_id_idx").on(table.providerKeyId),
		index("custom_model_organization_id_idx").on(table.organizationId),
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
		// Set when the request was authenticated with an end-user session. apiKeyId
		// points to the stable end-customer aggregate key; this points to the
		// actual short-lived browser session.
		endUserSessionId: text(),
		// Set when the request was authenticated with an end-user session: the
		// worker debits this wallet instead of organization.credits, and
		// per-end-user usage history keys off these.
		endCustomerWalletId: text(),
		endCustomerId: text(),
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
		cacheWriteTokens: decimal(),
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
		cacheWriteInputCost: real(),
		requestCost: real(),
		webSearchCost: real(),
		contentFilterCost: real(),
		imageInputTokens: decimal(),
		imageOutputTokens: decimal(),
		imageInputCost: real(),
		imageOutputCost: real(),
		audioInputTokens: decimal(),
		audioInputCost: real(),
		videoOutputCost: real(),
		videoDownloadCount: integer().notNull().default(0),
		lastVideoDownloadedAt: timestamp(),
		estimatedCost: boolean().default(false),
		discount: real(),
		pricingTier: text(),
		// The processing tier the client explicitly requested (e.g. "flex" /
		// "priority"). Null when no premium tier was requested.
		requestedServiceTier: text(),
		// The processing tier the provider actually served (e.g. "flex" /
		// "priority"), resolved from the upstream response. Null for the standard
		// tier or providers without tiers. Billed token costs reflect this tier.
		usedServiceTier: text(),
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
		sessionId: text(),
		customHeaders: json().$type<{ [key: string]: string }>(),
		routingMetadata: json().$type<{
			availableProviders?: string[];
			selectedProvider?: string;
			selectionReason?: string;
			usedApiKeyHash?: string;
			providerScores?: Array<{
				providerId: string;
				region?: string;
				score: number;
				uptime?: number;
				latency?: number;
				throughput?: number;
				price?: number;
				priority?: number;
				cacheSupported?: boolean;
				failed?: boolean;
				status_code?: number;
				error_type?: string;
				rate_limited?: boolean;
				contentFilterProvider?: boolean;
				excludedByContentFilter?: boolean;
			}>;
			originalProvider?: string;
			originalProviderUptime?: number;
			originalProviderRateLimited?: boolean;
			noFallback?: boolean;
			xNoFallbackHeaderSet?: boolean;
			contentFilterMatched?: boolean;
			contentFilterRerouted?: boolean;
			contentFilterExcludedProviders?: string[];
			routing?: Array<{
				provider: string;
				model: string;
				region?: string;
				status_code: number;
				error_type: string;
				succeeded: boolean;
				apiKeyHash?: string;
				logId?: string;
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
		internalContentFilter: boolean(),
		gatewayContentFilterResponse:
			jsonb().$type<z.infer<typeof gatewayContentFilterResponseSchema>>(),
		responsesApiId: text(),
		responsesApiData: jsonb(),
	},
	(table) => [
		index("log_project_id_created_at_idx").on(table.projectId, table.createdAt),
		index("log_request_id_idx").on(table.requestId),
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
		// Partial index for activity-log filtering by session id within a project
		index("log_project_id_session_id_idx")
			.on(table.projectId, table.sessionId, table.createdAt)
			.where(sql`session_id IS NOT NULL`),
		// Index for activity-log filtering by api key. api_key_id is globally
		// unique so it determines the project; no project_id prefix needed.
		index("log_api_key_id_created_at_idx").on(table.apiKeyId, table.createdAt),
		index("log_end_customer_wallet_id_created_at_idx")
			.on(table.endCustomerWalletId, table.createdAt)
			.where(sql`end_customer_wallet_id IS NOT NULL`),
		index("log_end_user_session_id_created_at_idx")
			.on(table.endUserSessionId, table.createdAt)
			.where(sql`end_user_session_id IS NOT NULL`),
		// Partial index for batch credit processing: only indexes unprocessed logs
		index("log_processed_at_null_idx")
			.on(table.createdAt)
			.where(sql`processed_at IS NULL`),
	],
);

export const videoJob = pgTable(
	"video_job",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		requestId: text().notNull(),
		// Internal id of the log row created when the job is finalized. Used for
		// all internal job<->log lookups instead of matching on requestId.
		logId: text().references(() => log.id, { onDelete: "set null" }),
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
		// LLM SDK: for jobs created under an end-user session, the
		// concrete session id and owning wallet. Null for normal developer keys.
		endUserSessionId: text().references(() => endUserSession.id, {
			onDelete: "set null",
		}),
		// LLM SDK: for jobs created under an end-user session, the
		// owning wallet. Null for normal developer keys. Read routes enforce that a
		// session may only access its own wallet's jobs (per-end-user isolation
		// within a shared project).
		endCustomerWalletId: text().references(() => wallet.id, {
			onDelete: "set null",
		}),
		mode: text({
			enum: ["api-keys", "credits", "hybrid"],
		}).notNull(),
		usedMode: text({
			enum: ["api-keys", "credits"],
		}).notNull(),
		model: text().notNull(),
		requestedProvider: text(),
		usedProvider: text().notNull(),
		usedModel: text().notNull(),
		providerConfigIndex: integer(),
		upstreamId: text().notNull(),
		prompt: text().notNull(),
		status: text({
			enum: [
				"queued",
				"in_progress",
				"completed",
				"failed",
				"canceled",
				"expired",
			],
		})
			.notNull()
			.default("queued"),
		progress: integer().notNull().default(0),
		error: jsonb().$type<{
			code?: string;
			message: string;
			details?: unknown;
		}>(),
		contentUrl: text(),
		storageProvider: text(),
		storageBucket: text(),
		storageObjectPath: text(),
		storageUri: text(),
		storageExpiresAt: timestamp(),
		contentType: text(),
		completedAt: timestamp(),
		expiresAt: timestamp(),
		lastPolledAt: timestamp(),
		nextPollAt: timestamp().notNull().defaultNow(),
		pollAttemptCount: integer().notNull().default(0),
		callbackUrl: text(),
		callbackSecret: text(),
		callbackStatus: text({
			enum: ["none", "pending", "delivered", "failed"],
		})
			.notNull()
			.default("none"),
		callbackEventId: text(),
		callbackEventType: text(),
		callbackDeliveredAt: timestamp(),
		resultLoggedAt: timestamp(),
		routingMetadata: jsonb().$type<{
			availableProviders?: string[];
			selectedProvider?: string;
			selectionReason?: string;
			usedApiKeyHash?: string;
			providerScores?: Array<{
				providerId: string;
				region?: string;
				score: number;
				uptime?: number;
				latency?: number;
				throughput?: number;
				price?: number;
				priority?: number;
				cacheSupported?: boolean;
				failed?: boolean;
				status_code?: number;
				error_type?: string;
				rate_limited?: boolean;
				contentFilterProvider?: boolean;
				excludedByContentFilter?: boolean;
			}>;
			originalProvider?: string;
			originalProviderUptime?: number;
			originalProviderRateLimited?: boolean;
			noFallback?: boolean;
			xNoFallbackHeaderSet?: boolean;
			contentFilterMatched?: boolean;
			contentFilterRerouted?: boolean;
			contentFilterExcludedProviders?: string[];
			routing?: Array<{
				provider: string;
				model: string;
				region?: string;
				status_code: number;
				error_type: string;
				succeeded: boolean;
				apiKeyHash?: string;
				logId?: string;
			}>;
		}>(),
		upstreamCreateResponse: jsonb(),
		upstreamStatusResponse: jsonb(),
	},
	(table) => [
		index("video_job_project_id_created_at_idx").on(
			table.projectId,
			table.createdAt,
		),
		index("video_job_status_next_poll_at_idx").on(
			table.status,
			table.nextPollAt,
		),
		index("video_job_upstream_id_idx").on(table.upstreamId),
		index("video_job_log_id_idx").on(table.logId),
		index("video_job_callback_status_idx").on(table.callbackStatus),
		index("video_job_end_user_session_id_idx").on(table.endUserSessionId),
	],
);

export const webhookDeliveryLog = pgTable(
	"webhook_delivery_log",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		videoJobId: text()
			.notNull()
			.references(() => videoJob.id, { onDelete: "cascade" }),
		eventId: text().notNull(),
		eventType: text().notNull(),
		targetUrl: text().notNull(),
		attempt: integer().notNull().default(1),
		status: text({
			enum: ["pending", "retrying", "delivered", "failed"],
		})
			.notNull()
			.default("pending"),
		lastTriedAt: timestamp(),
		nextRetryAt: timestamp().notNull().defaultNow(),
		deliveredAt: timestamp(),
		requestHeaders: jsonb(),
		requestBody: jsonb(),
		responseStatus: integer(),
		responseBody: text(),
		error: text(),
	},
	(table) => [
		index("webhook_delivery_log_video_job_id_idx").on(table.videoJobId),
		index("webhook_delivery_log_status_next_retry_at_idx").on(
			table.status,
			table.nextRetryAt,
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
		aaguid: text(),
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

export const chatProject = pgTable(
	"chat_project",
	{
		id: text().primaryKey().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		name: text().notNull(),
		description: text().notNull().default(""),
		// Custom instructions prepended to the system prompt of chats in this
		// project, like Claude's project instructions.
		instructions: text().notNull().default(""),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		// Same semantics as chat.organizationId: null means the default
		// "Chat plan" context.
		organizationId: text().references(() => organization.id, {
			onDelete: "set null",
		}),
	},
	(table) => [index("chat_project_user_id_idx").on(table.userId)],
);

export const chatProjectFile = pgTable(
	"chat_project_file",
	{
		id: text().primaryKey().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		projectId: text()
			.notNull()
			.references(() => chatProject.id, { onDelete: "cascade" }),
		name: text().notNull(),
		mimeType: text().notNull(),
		size: integer().notNull(),
		// Full extracted text content of the file, kept for viewing and
		// re-indexing. Chunked copies live in chat_project_file_chunk.
		content: text().notNull(),
		status: text({
			enum: ["processing", "ready", "error"],
		})
			.notNull()
			.default("processing"),
		error: text(),
		chunkCount: integer().notNull().default(0),
	},
	(table) => [index("chat_project_file_project_id_idx").on(table.projectId)],
);

export const chatProjectFileChunk = pgTable(
	"chat_project_file_chunk",
	{
		id: text().primaryKey().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		fileId: text()
			.notNull()
			.references(() => chatProjectFile.id, { onDelete: "cascade" }),
		// Denormalized so retrieval can load all of a project's chunks without
		// joining through chat_project_file.
		projectId: text()
			.notNull()
			.references(() => chatProject.id, { onDelete: "cascade" }),
		chunkIndex: integer().notNull(),
		content: text().notNull(),
		embedding: jsonb().$type<number[]>().notNull(),
	},
	(table) => [
		index("chat_project_file_chunk_file_id_idx").on(table.fileId),
		index("chat_project_file_chunk_project_id_idx").on(table.projectId),
	],
);

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
		// The organization context the chat was created under. Null means the
		// default "Chat plan" context (legacy rows are treated as such). Used to
		// keep chat history separated per selected organization. On org deletion
		// the chat reverts to the Chat plan context rather than being removed.
		organizationId: text().references(() => organization.id, {
			onDelete: "set null",
		}),
		model: text().notNull(),
		status: text({
			enum: ["active", "archived", "deleted"],
		}).default("active"),
		webSearch: boolean().default(false),
		pinned: boolean().notNull().default(false),
		comparisonEnabled: boolean().notNull().default(false),
		parentChatId: text().references((): AnyPgColumn => chat.id, {
			onDelete: "cascade",
		}),
		// Chat project (knowledge base) this chat belongs to, if any.
		projectId: text().references(() => chatProject.id, {
			onDelete: "set null",
		}),
	},
	(table) => [
		index("chat_user_id_idx").on(table.userId),
		index("chat_project_id_idx").on(table.projectId),
	],
);

export const chatShare = pgTable(
	"chat_share",
	{
		id: text().primaryKey().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		deletedAt: timestamp(),
		chatId: text()
			.notNull()
			.references(() => chat.id, { onDelete: "cascade" }),
		organizationId: text().references(() => organization.id, {
			onDelete: "cascade",
		}),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		title: text().notNull(),
		model: text().notNull(),
		messages: jsonb().notNull(),
	},
	(table) => [
		uniqueIndex("chat_share_active_chat_id_public_unique")
			.on(table.chatId)
			.where(
				sql`${table.deletedAt} IS NULL AND ${table.organizationId} IS NULL`,
			),
		uniqueIndex("chat_share_active_chat_id_org_unique")
			.on(table.chatId, table.organizationId)
			.where(
				sql`${table.deletedAt} IS NULL AND ${table.organizationId} IS NOT NULL`,
			),
		index("chat_share_chat_id_idx").on(table.chatId),
		index("chat_share_organization_id_idx").on(table.organizationId),
		index("chat_share_deleted_at_idx").on(table.deletedAt),
	],
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
		audios: text(), // JSON string to store audio attachments array
		documents: text(), // JSON string to store document attachments array
		reasoning: text(), // Reasoning content from AI models
		tools: text(), // JSON string to store tool call parts
		sources: text(), // JSON string to store web search source citations
		metadata: jsonb().$type<Record<string, unknown>>(),
		sequence: integer().notNull(), // To maintain message order
	},
	(table) => [index("message_chat_id_idx").on(table.chatId)],
);

export const chatSupportConversation = pgTable(
	"chat_support_conversation",
	{
		id: text().primaryKey().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		clientId: text(),
		name: text(),
		email: text(),
		ipAddress: text(),
		userAgent: text(),
		messageCount: integer().notNull().default(0),
		escalatedAt: timestamp(),
		archivedAt: timestamp(),
		resolvedAt: timestamp(),
		rating: integer(),
	},
	(table) => [
		index("chat_support_conversation_created_at_idx").on(table.createdAt),
		index("chat_support_conversation_client_id_idx").on(table.clientId),
		check(
			"chat_support_conversation_rating_check",
			sql`${table.rating} IS NULL OR (${table.rating} >= 0 AND ${table.rating} <= 5)`,
		),
	],
);

export const chatSupportMessage = pgTable(
	"chat_support_message",
	{
		id: text().primaryKey().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		conversationId: text()
			.notNull()
			.references(() => chatSupportConversation.id, { onDelete: "cascade" }),
		role: text({
			enum: ["user", "assistant", "admin"],
		}).notNull(),
		content: text().notNull(),
		sequence: integer().notNull(),
		reaction: text({
			enum: ["like", "dislike"],
		}),
	},
	(table) => [
		index("chat_support_message_conversation_id_idx").on(table.conversationId),
		check(
			"chat_support_message_reaction_check",
			sql`${table.reaction} IS NULL OR ${table.reaction} IN ('like', 'dislike')`,
		),
	],
);

export const chatSupportReadStatus = pgTable(
	"chat_support_read_status",
	{
		id: text().primaryKey().$defaultFn(shortid),
		conversationId: text()
			.notNull()
			.references(() => chatSupportConversation.id, { onDelete: "cascade" }),
		adminUserId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		lastReadMessageCount: integer().notNull().default(0),
		readAt: timestamp().notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex("chat_support_read_status_conv_admin_idx").on(
			table.conversationId,
			table.adminUserId,
		),
	],
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
		imageInputRequired: boolean().default(false).notNull(),
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
		externalId: text().notNull(),
		region: text(),
		inputPrice: decimal(),
		outputPrice: decimal(),
		cachedInputPrice: decimal(),
		cacheWriteInputPrice: decimal(),
		cacheWriteInputPrice1h: decimal(),
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
		statsUpdatedAt: timestamp(),
	},
	(table) => [
		unique().on(table.modelId, table.providerId, table.region),
		index("model_provider_mapping_status_model_id_idx").on(
			table.status,
			table.modelId,
		),
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
		completedCount: integer().notNull().default(0),
		lengthLimitCount: integer().notNull().default(0),
		contentFilterCount: integer().notNull().default(0),
		toolCallsCount: integer().notNull().default(0),
		canceledCount: integer().notNull().default(0),
		unknownFinishCount: integer().notNull().default(0),
		cachedCount: integer().notNull().default(0),
		totalInputTokens: integer().notNull().default(0),
		totalOutputTokens: integer().notNull().default(0),
		totalTokens: integer().notNull().default(0),
		totalReasoningTokens: integer().notNull().default(0),
		totalCachedTokens: integer().notNull().default(0),
		totalDuration: integer().notNull().default(0),
		totalTimeToFirstToken: integer().notNull().default(0),
		totalTimeToFirstReasoningToken: integer().notNull().default(0),
		totalCost: real().notNull().default(0),
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
		// Index for admin model detail queries (filter by model + time range)
		index("model_provider_mapping_history_model_id_minute_timestamp_idx").on(
			table.modelId,
			table.minuteTimestamp,
		),
		// Index for admin provider+model mapping queries
		index("model_provider_mapping_history_id_ts_idx").on(
			table.providerId,
			table.modelId,
			table.minuteTimestamp,
		),
		// Covering index for the public provider stats aggregation
		// (filter by minuteTimestamp range, group by providerId, sum metrics).
		// Including the summed columns as trailing keys enables an index-only
		// scan so Postgres never has to touch the heap for this query.
		index("model_provider_mapping_history_provider_stats_idx").on(
			table.minuteTimestamp,
			table.providerId,
			table.logsCount,
			table.errorsCount,
			table.cachedCount,
			table.totalTimeToFirstToken,
			table.totalOutputTokens,
			table.totalDuration,
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
		completedCount: integer().notNull().default(0),
		lengthLimitCount: integer().notNull().default(0),
		contentFilterCount: integer().notNull().default(0),
		toolCallsCount: integer().notNull().default(0),
		canceledCount: integer().notNull().default(0),
		unknownFinishCount: integer().notNull().default(0),
		cachedCount: integer().notNull().default(0),
		totalInputTokens: integer().notNull().default(0),
		totalOutputTokens: integer().notNull().default(0),
		totalTokens: integer().notNull().default(0),
		totalReasoningTokens: integer().notNull().default(0),
		totalCachedTokens: integer().notNull().default(0),
		totalDuration: integer().notNull().default(0),
		totalTimeToFirstToken: integer().notNull().default(0),
		totalTimeToFirstReasoningToken: integer().notNull().default(0),
		totalCost: real().notNull().default(0),
	},
	(table) => [
		// Unique constraint ensures one record per model-minute combination
		unique().on(table.modelId, table.minuteTimestamp),
		// Index for ORDER BY minuteTimestamp DESC queries
		index("model_history_minute_timestamp_idx").on(table.minuteTimestamp),
		// Index for admin model history queries (filter by model + time range)
		index("model_history_model_id_minute_timestamp_idx").on(
			table.modelId,
			table.minuteTimestamp,
		),
	],
);

// Hourly rollup of model_provider_mapping_history. Each row summarizes one
// hour by summing the 60 minute rows for a mapping, for cheap long-range
// queries that don't need minute granularity.
export const modelProviderMappingHistoryHourly = pgTable(
	"model_provider_mapping_history_hourly",
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
		// Unique timestamp key for one-hour intervals (rounded down to the hour)
		hourTimestamp: timestamp().notNull(),
		logsCount: integer().notNull().default(0),
		errorsCount: integer().notNull().default(0),
		clientErrorsCount: integer().notNull().default(0),
		gatewayErrorsCount: integer().notNull().default(0),
		upstreamErrorsCount: integer().notNull().default(0),
		completedCount: integer().notNull().default(0),
		lengthLimitCount: integer().notNull().default(0),
		contentFilterCount: integer().notNull().default(0),
		toolCallsCount: integer().notNull().default(0),
		canceledCount: integer().notNull().default(0),
		unknownFinishCount: integer().notNull().default(0),
		cachedCount: integer().notNull().default(0),
		// Token totals sum 60 minute rows, so a high-volume hour can exceed the
		// 32-bit integer range; use bigint to avoid overflow on the rollup.
		totalInputTokens: bigint({ mode: "number" }).notNull().default(0),
		totalOutputTokens: bigint({ mode: "number" }).notNull().default(0),
		totalTokens: bigint({ mode: "number" }).notNull().default(0),
		totalReasoningTokens: bigint({ mode: "number" }).notNull().default(0),
		totalCachedTokens: bigint({ mode: "number" }).notNull().default(0),
		totalDuration: integer().notNull().default(0),
		totalTimeToFirstToken: integer().notNull().default(0),
		totalTimeToFirstReasoningToken: integer().notNull().default(0),
		totalCost: real().notNull().default(0),
	},
	(table) => [
		// Unique constraint ensures one record per mapping-hour combination
		unique().on(table.modelProviderMappingId, table.hourTimestamp),
		// Index for ORDER BY hourTimestamp DESC queries
		index("mpm_history_hourly_ts_idx").on(table.hourTimestamp),
		// Composite index for aggregation queries by providerId
		index("mpm_history_hourly_ts_provider_idx").on(
			table.hourTimestamp,
			table.providerId,
		),
		// Composite index for aggregation queries by modelId
		index("mpm_history_hourly_ts_model_idx").on(
			table.hourTimestamp,
			table.modelId,
		),
		// Index for admin model detail queries (filter by model + time range)
		index("mpm_history_hourly_model_ts_idx").on(
			table.modelId,
			table.hourTimestamp,
		),
		// Covering index for the public provider stats aggregation
		// (filter by hourTimestamp range, group by providerId, sum metrics).
		index("mpm_history_hourly_provider_stats_idx").on(
			table.hourTimestamp,
			table.providerId,
			table.logsCount,
			table.errorsCount,
			table.cachedCount,
			table.totalTimeToFirstToken,
			table.totalOutputTokens,
			table.totalDuration,
		),
	],
);

// Hourly rollup of model_history. Each row summarizes one hour by summing the
// 60 minute rows for a model.
export const modelHistoryHourly = pgTable(
	"model_history_hourly",
	{
		id: text().primaryKey().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		modelId: text().notNull(),
		// Unique timestamp key for one-hour intervals (rounded down to the hour)
		hourTimestamp: timestamp().notNull(),
		logsCount: integer().notNull().default(0),
		errorsCount: integer().notNull().default(0),
		clientErrorsCount: integer().notNull().default(0),
		gatewayErrorsCount: integer().notNull().default(0),
		upstreamErrorsCount: integer().notNull().default(0),
		completedCount: integer().notNull().default(0),
		lengthLimitCount: integer().notNull().default(0),
		contentFilterCount: integer().notNull().default(0),
		toolCallsCount: integer().notNull().default(0),
		canceledCount: integer().notNull().default(0),
		unknownFinishCount: integer().notNull().default(0),
		cachedCount: integer().notNull().default(0),
		// Token totals sum 60 minute rows, so a high-volume hour can exceed the
		// 32-bit integer range; use bigint to avoid overflow on the rollup.
		totalInputTokens: bigint({ mode: "number" }).notNull().default(0),
		totalOutputTokens: bigint({ mode: "number" }).notNull().default(0),
		totalTokens: bigint({ mode: "number" }).notNull().default(0),
		totalReasoningTokens: bigint({ mode: "number" }).notNull().default(0),
		totalCachedTokens: bigint({ mode: "number" }).notNull().default(0),
		totalDuration: integer().notNull().default(0),
		totalTimeToFirstToken: integer().notNull().default(0),
		totalTimeToFirstReasoningToken: integer().notNull().default(0),
		totalCost: real().notNull().default(0),
	},
	(table) => [
		// Unique constraint ensures one record per model-hour combination
		unique().on(table.modelId, table.hourTimestamp),
		// Index for ORDER BY hourTimestamp DESC queries
		index("model_history_hourly_ts_idx").on(table.hourTimestamp),
		// Index for admin model history queries (filter by model + time range)
		index("model_history_hourly_model_ts_idx").on(
			table.modelId,
			table.hourTimestamp,
		),
	],
);

// Audit Log - Enterprise feature for tracking all API actions
export const auditLogActions = [
	// Organization
	"organization.create",
	"organization.update",
	"organization.delete",
	"organization.block",
	// Project
	"project.create",
	"project.update",
	"project.delete",
	// Team
	"team_member.add",
	"team_member.update",
	"team_member.budget_update",
	"team_member.remove",
	// API Key
	"api_key.create",
	"api_key.roll",
	"api_key.update_status",
	"api_key.update_limit",
	"api_key.update_description",
	"api_key.delete",
	"api_key.iam_rule.create",
	"api_key.iam_rule.update",
	"api_key.iam_rule.delete",
	// Master Key
	"master_key.create",
	"master_key.update_status",
	"master_key.delete",
	// Provider Key
	"provider_key.create",
	"provider_key.update",
	"provider_key.delete",
	// Custom Model
	"custom_model.create",
	"custom_model.update",
	"custom_model.delete",
	// Subscription
	"subscription.create",
	"subscription.cancel",
	"subscription.resume",
	"subscription.upgrade_yearly",
	// Payment
	"payment.method.set_default",
	"payment.method.delete",
	"payment.credit_topup",
	"payment.auto_topup.update",
	"payment.auto_topup.disable",
	// Credits
	"credits.gift",
	// Referral
	"referral_bonus.update",
	// Dev Plan
	"dev_plan.subscribe",
	"dev_plan.cancel",
	"dev_plan.resume",
	"dev_plan.change_tier",
	"dev_plan.cancel_downgrade",
	"dev_plan.update_settings",
	"dev_plan.update_billing_details",
	"dev_plan.rotate_api_key",
	"dev_plan.update_payment_method",
	// Chat Plan
	"chat_plan.subscribe",
	"chat_plan.cancel",
	"chat_plan.resume",
	"chat_plan.change_tier",
] as const;

export const auditLogResourceTypes = [
	"organization",
	"project",
	"team_member",
	"api_key",
	"master_key",
	"iam_rule",
	"provider_key",
	"custom_model",
	"subscription",
	"payment_method",
	"payment",
	"dev_plan",
	"chat_plan",
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

export interface RoutingWeightsConfig {
	price?: number;
	imagePrice?: number;
	uptime?: number;
	throughput?: number;
	latency?: number;
	cache?: number;
}

export interface RoutingThresholdsConfig {
	cachePromptTokens?: number;
	uptimePenalty?: number;
	defaultUptime?: number;
	defaultLatency?: number;
	defaultThroughput?: number;
	explorationRate?: number;
}

export interface RoutingRetryConfig {
	maxRetries?: number;
	lowUptimeFallbackThreshold?: number;
}

export interface RoutingTimeoutsConfig {
	gatewayMs?: number;
	streamingMs?: number;
	plainMs?: number;
}

export interface RoutingHistoryConfig {
	windowMinutes?: number;
	tier1Minutes?: number;
	tier2Minutes?: number;
	tier1Weight?: number;
	tier2Weight?: number;
	tier3Weight?: number;
}

export interface RoutingStickyConfig {
	enabled?: boolean;
	ttlSeconds?: number;
	uptimeThreshold?: number;
	scoreMargin?: number;
}

export interface RoutingSessionConfig {
	enabled?: boolean;
}

export type ProviderPriorityOverrides = Record<string, number>;

export const routingConfig = pgTable(
	"routing_config",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" })
			.unique(),
		enabled: boolean().default(false).notNull(),
		weights: jsonb().$type<RoutingWeightsConfig>(),
		thresholds: jsonb().$type<RoutingThresholdsConfig>(),
		retry: jsonb().$type<RoutingRetryConfig>(),
		timeouts: jsonb().$type<RoutingTimeoutsConfig>(),
		history: jsonb().$type<RoutingHistoryConfig>(),
		sticky: jsonb().$type<RoutingStickyConfig>(),
		session: jsonb().$type<RoutingSessionConfig>(),
		providerPriorities: jsonb(
			"provider_priorities",
		).$type<ProviderPriorityOverrides>(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [index("routing_config_project_id_idx").on(table.projectId)],
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

// Rate Limit - Admin-configurable provider/model caps
// Can be global (organizationId = null) or org-specific
export const rateLimit = pgTable(
	"rate_limit",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		// Scope: null = global rate limit, otherwise org-specific
		organizationId: text().references(() => organization.id, {
			onDelete: "cascade",
		}),
		// Target: provider-only, model-only, or both
		// null provider = applies to all providers
		provider: text(),
		// null model = applies to all models (of provider if specified)
		model: text(),
		// Maximum requests per minute
		maxRpm: integer(),
		// Maximum requests per day
		maxRpd: integer(),
		// How the counter is bucketed across orgs (only meaningful for global rows):
		// "per_org" = each org gets its own counter (default), "global" = single shared counter
		enforcement: text({ enum: ["per_org", "global"] })
			.notNull()
			.default("per_org"),
		// Optional metadata
		reason: text(),
	},
	(table) => [
		// One row per org/provider/model combo with both RPM and RPD on the same row.
		// Coalesce nulls to sentinels so Postgres treats them as equal.
		uniqueIndex("rate_limit_org_provider_model_unique").using(
			"btree",
			sql`coalesce(${table.organizationId}, '__global__')`,
			sql`coalesce(${table.provider}, '__all_providers__')`,
			sql`coalesce(${table.model}, '__all_models__')`,
		),
		index("rate_limit_organization_id_idx").on(table.organizationId),
		index("rate_limit_provider_idx").on(table.provider),
		index("rate_limit_model_idx").on(table.model),
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
		cacheWriteTokens: decimal().notNull().default("0"),
		// Costs
		cost: real().notNull().default(0),
		inputCost: real().notNull().default(0),
		outputCost: real().notNull().default(0),
		requestCost: real().notNull().default(0),
		dataStorageCost: real().notNull().default(0),
		discountSavings: real().notNull().default(0),
		imageInputCost: real().notNull().default(0),
		imageOutputCost: real().notNull().default(0),
		audioInputCost: real().notNull().default(0),
		videoOutputCost: real().notNull().default(0),
		cachedInputCost: real().notNull().default(0),
		cacheWriteInputCost: real().notNull().default(0),
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
		cacheWriteTokens: decimal().notNull().default("0"),
		// Costs
		cost: real().notNull().default(0),
		inputCost: real().notNull().default(0),
		outputCost: real().notNull().default(0),
		requestCost: real().notNull().default(0),
		dataStorageCost: real().notNull().default(0),
		discountSavings: real().notNull().default(0),
		imageInputCost: real().notNull().default(0),
		imageOutputCost: real().notNull().default(0),
		audioInputCost: real().notNull().default(0),
		videoOutputCost: real().notNull().default(0),
		cachedInputCost: real().notNull().default(0),
		cacheWriteInputCost: real().notNull().default(0),
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
		// Index for admin model detail queries (global aggregation by model)
		index("project_hourly_model_stats_used_model_hour_timestamp_idx").on(
			table.usedModel,
			table.hourTimestamp,
		),
		// Index for admin provider+model queries
		index("project_hourly_model_stats_p_m_time_idx").on(
			table.usedProvider,
			table.usedModel,
			table.hourTimestamp,
		),
	],
);

// Project hourly source statistics — per-project aggregation by the x-source
// header (e.g. coding agents). Mirrors projectHourlyModelStats but keyed by
// source. NULL log.source rows are stored under the literal 'unknown' so the
// unique constraint and onConflictDoUpdate target stay valid.
export const projectHourlySourceStats = pgTable(
	"project_hourly_source_stats",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		projectId: text().notNull(),
		hourTimestamp: timestamp().notNull(), // Start of the hour bucket
		source: text().notNull(),
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
		cacheWriteTokens: decimal().notNull().default("0"),
		// Costs
		cost: real().notNull().default(0),
		inputCost: real().notNull().default(0),
		outputCost: real().notNull().default(0),
		requestCost: real().notNull().default(0),
		dataStorageCost: real().notNull().default(0),
		discountSavings: real().notNull().default(0),
		imageInputCost: real().notNull().default(0),
		imageOutputCost: real().notNull().default(0),
		audioInputCost: real().notNull().default(0),
		videoOutputCost: real().notNull().default(0),
		cachedInputCost: real().notNull().default(0),
		cacheWriteInputCost: real().notNull().default(0),
		// Per-mode breakdowns
		creditsRequestCount: integer().notNull().default(0),
		apiKeysRequestCount: integer().notNull().default(0),
		creditsCost: real().notNull().default(0),
		apiKeysCost: real().notNull().default(0),
		creditsDataStorageCost: real().notNull().default(0),
		apiKeysDataStorageCost: real().notNull().default(0),
	},
	(table) => [
		// Unique constraint for one record per project-hour-source
		unique().on(table.projectId, table.hourTimestamp, table.source),
		// Index for dashboard queries (project + time range)
		index("project_hourly_source_stats_project_id_hour_timestamp_idx").on(
			table.projectId,
			table.hourTimestamp,
		),
		// Index for worker refresh queries
		index("project_hourly_source_stats_hour_timestamp_idx").on(
			table.hourTimestamp,
		),
		// Index for admin source detail queries (aggregation by source)
		index("project_hourly_source_stats_source_hour_timestamp_idx").on(
			table.source,
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
		cacheWriteTokens: decimal().notNull().default("0"),
		// Costs
		cost: real().notNull().default(0),
		inputCost: real().notNull().default(0),
		outputCost: real().notNull().default(0),
		requestCost: real().notNull().default(0),
		dataStorageCost: real().notNull().default(0),
		discountSavings: real().notNull().default(0),
		imageInputCost: real().notNull().default(0),
		imageOutputCost: real().notNull().default(0),
		audioInputCost: real().notNull().default(0),
		videoOutputCost: real().notNull().default(0),
		cachedInputCost: real().notNull().default(0),
		cacheWriteInputCost: real().notNull().default(0),
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
		cacheWriteTokens: decimal().notNull().default("0"),
		// Costs
		cost: real().notNull().default(0),
		inputCost: real().notNull().default(0),
		outputCost: real().notNull().default(0),
		requestCost: real().notNull().default(0),
		dataStorageCost: real().notNull().default(0),
		discountSavings: real().notNull().default(0),
		imageInputCost: real().notNull().default(0),
		imageOutputCost: real().notNull().default(0),
		audioInputCost: real().notNull().default(0),
		videoOutputCost: real().notNull().default(0),
		cachedInputCost: real().notNull().default(0),
		cacheWriteInputCost: real().notNull().default(0),
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

// Global model statistics — cross-org, cross-project aggregation by model.
// Rows are day-bucketed (`dayTimestamp`); the worker can update them at any
// cadence via the configurable bucket size.
export const globalModelStats = pgTable(
	"global_model_stats",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		dayTimestamp: timestamp().notNull(), // Start of the UTC day bucket
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
		cacheWriteTokens: decimal().notNull().default("0"),
		// Costs
		cost: real().notNull().default(0),
		inputCost: real().notNull().default(0),
		outputCost: real().notNull().default(0),
		requestCost: real().notNull().default(0),
		dataStorageCost: real().notNull().default(0),
		discountSavings: real().notNull().default(0),
		imageInputCost: real().notNull().default(0),
		imageOutputCost: real().notNull().default(0),
		audioInputCost: real().notNull().default(0),
		videoOutputCost: real().notNull().default(0),
		cachedInputCost: real().notNull().default(0),
		cacheWriteInputCost: real().notNull().default(0),
		// Per-mode breakdowns
		creditsRequestCount: integer().notNull().default(0),
		apiKeysRequestCount: integer().notNull().default(0),
		creditsCost: real().notNull().default(0),
		apiKeysCost: real().notNull().default(0),
		creditsDataStorageCost: real().notNull().default(0),
		apiKeysDataStorageCost: real().notNull().default(0),
	},
	(table) => [
		unique().on(table.dayTimestamp, table.usedModel, table.usedProvider),
		index("global_model_stats_day_timestamp_idx").on(table.dayTimestamp),
		index("global_model_stats_used_model_day_timestamp_idx").on(
			table.usedModel,
			table.dayTimestamp,
		),
		index("global_model_stats_p_m_time_idx").on(
			table.usedProvider,
			table.usedModel,
			table.dayTimestamp,
		),
	],
);

// Global source statistics — cross-org, cross-project aggregation by x-source header.
export const globalSourceStats = pgTable(
	"global_source_stats",
	{
		id: text().primaryKey().notNull().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		dayTimestamp: timestamp().notNull(), // Start of the UTC day bucket
		// NULL log.source rows are stored under the literal 'unknown' so the
		// unique constraint and onConflictDoUpdate target stay valid.
		source: text().notNull(),
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
		cacheWriteTokens: decimal().notNull().default("0"),
		// Costs
		cost: real().notNull().default(0),
		inputCost: real().notNull().default(0),
		outputCost: real().notNull().default(0),
		requestCost: real().notNull().default(0),
		dataStorageCost: real().notNull().default(0),
		discountSavings: real().notNull().default(0),
		imageInputCost: real().notNull().default(0),
		imageOutputCost: real().notNull().default(0),
		audioInputCost: real().notNull().default(0),
		videoOutputCost: real().notNull().default(0),
		cachedInputCost: real().notNull().default(0),
		cacheWriteInputCost: real().notNull().default(0),
		// Per-mode breakdowns
		creditsRequestCount: integer().notNull().default(0),
		apiKeysRequestCount: integer().notNull().default(0),
		creditsCost: real().notNull().default(0),
		apiKeysCost: real().notNull().default(0),
		creditsDataStorageCost: real().notNull().default(0),
		apiKeysDataStorageCost: real().notNull().default(0),
	},
	(table) => [
		unique().on(table.dayTimestamp, table.source),
		index("global_source_stats_day_timestamp_idx").on(table.dayTimestamp),
		index("global_source_stats_source_day_timestamp_idx").on(
			table.source,
			table.dayTimestamp,
		),
	],
);

// Singleton state row for the incremental global-stats aggregator.
// `lastProcessedHour` is the last UTC bucket that has been folded into the
// daily stats. `lastSafetyNetDay` is the most recent UTC day that has been
// fully recomputed by the safety-net pass.
export const globalAggregationState = pgTable("global_aggregation_state", {
	id: text().primaryKey().notNull().default("singleton"),
	lastProcessedHour: timestamp(),
	lastSafetyNetDay: timestamp(),
	updatedAt: timestamp()
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
});

export const skill = pgTable(
	"skill",
	{
		id: text().primaryKey().$defaultFn(shortid),
		createdAt: timestamp().notNull().defaultNow(),
		updatedAt: timestamp()
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text().notNull(),
		description: text().notNull(),
		instructions: text().notNull(),
		enabled: boolean().notNull().default(true),
	},
	(table) => [index("skill_user_id_idx").on(table.userId)],
);

export const playgroundImageHistory = pgTable(
	"playground_image_history",
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
		// Organization context the generation was created under. Null means the
		// default "Chat plan" context. Used to separate history per organization.
		organizationId: text().references(() => organization.id, {
			onDelete: "set null",
		}),
		prompt: text().notNull(),
		inputImages: jsonb().$type<{ dataUrl: string; mediaType: string }[]>(),
		models: jsonb().notNull().$type<
			{
				modelId: string;
				modelName: string;
				images: { base64: string; mediaType: string }[];
				error?: string;
			}[]
		>(),
	},
	(table) => [index("playground_image_history_user_id_idx").on(table.userId)],
);

export const playgroundAudioHistory = pgTable(
	"playground_audio_history",
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
		// Organization context the generation was created under. Null means the
		// default "Chat plan" context. Used to separate history per organization.
		organizationId: text().references(() => organization.id, {
			onDelete: "set null",
		}),
		prompt: text().notNull(),
		voice: text(),
		models: jsonb().notNull().$type<
			{
				modelId: string;
				modelName: string;
				audio: { base64: string; mediaType: string } | null;
				error?: string;
			}[]
		>(),
	},
	(table) => [index("playground_audio_history_user_id_idx").on(table.userId)],
);

export const playgroundVideoHistory = pgTable(
	"playground_video_history",
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
		// Organization context the generation was created under. Null means the
		// default "Chat plan" context. Used to separate history per organization.
		organizationId: text().references(() => organization.id, {
			onDelete: "set null",
		}),
		prompt: text().notNull(),
		frameInputs: jsonb().$type<{
			start: { dataUrl: string; mediaType: string } | null;
			end: { dataUrl: string; mediaType: string } | null;
		}>(),
		referenceImages: jsonb().$type<{ dataUrl: string; mediaType: string }[]>(),
		models: jsonb().notNull().$type<
			{
				modelId: string;
				modelName: string;
				jobId: string | null;
				videoUrl: string | null;
				expiresAt?: number | null;
				error?: string;
			}[]
		>(),
	},
	(table) => [index("playground_video_history_user_id_idx").on(table.userId)],
);
