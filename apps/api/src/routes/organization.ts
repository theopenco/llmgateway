import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { isUserHighRisk } from "@/lib/account-risk.js";
import {
	computeSelfRefundEligibility,
	executeSelfRefund,
	isSelfRefundCandidateType,
	refundFeedbackBodySchema,
} from "@/lib/self-refund.js";
import {
	getUserProjectIds,
	userHasOrganizationAccess,
} from "@/utils/authorization.js";
import { getOrCreateDefaultOrganization } from "@/utils/default-org.js";
import {
	buildInvoiceDataForTransaction,
	generateInvoicePDF,
	isInvoiceableTransaction,
	isRefundTransaction,
} from "@/utils/invoice.js";
import { providerCacheControlModeSchema } from "@/utils/provider-cache-control.js";
import { isConfigurableDomain, normalizeDomain } from "@/utils/sso-domain.js";

import {
	getOrgTierQualifyingSpendUsd,
	getTopUpVelocityUsage,
} from "@llmgateway/actions";
import { logAuditEvent } from "@llmgateway/audit";
import { redisClient } from "@llmgateway/cache";
import {
	and,
	cdb,
	db,
	desc,
	eq,
	gte,
	isNull,
	or,
	sql,
	tables,
	projectHourlyStats,
} from "@llmgateway/db";
import { getProviderCountries, models, providers } from "@llmgateway/models";
import {
	CREDIT_TOP_UP_MAX_AMOUNT,
	CUSTOM_PROVIDER_NAME_REGEX,
	getBaseLimit,
	getNextSpendTier,
	getOrgSpendTier,
	getPlanClass,
	isCappedOrg,
	isOrgRateLimitEnabled,
	isSpendCapEnabled,
	isTopUpVelocityEnabled,
	isTopUpVelocityGatedOrg,
	PATH_RATE_LIMITS,
	resolveTrustTierOverride,
	spendDailyKey,
	spendMonthlyKey,
} from "@llmgateway/shared";
import { hasOrganizationEnterpriseAccess } from "@llmgateway/shared/enterprise-license";

import type { ServerTypes } from "@/vars.js";

export const organization = new OpenAPIHono<ServerTypes>();

// Closed set of provider-headquarters country codes defined in the catalogue.
// The compliance country filter may only reference these.
const providerCountryCodes = new Set(
	getProviderCountries().map((country) => country.code),
);

// Closed sets for the compliance policy's fine-grained restriction lists.
// Custom providers are addressed as `custom:<name>` and their models as
// `<name>/<model>`; the names are only format-validated because provider keys
// can be created/renamed independently of the stored policy.
const catalogueProviderIds = new Set<string>(
	providers.map((provider) => provider.id),
);
const catalogueModelIds = new Set<string>(models.map((model) => model.id));
const customProviderRefRegex = new RegExp(
	`^custom:${CUSTOM_PROVIDER_NAME_REGEX.source.slice(1, -1)}$`,
);
const customModelRefRegex = new RegExp(
	`^${CUSTOM_PROVIDER_NAME_REGEX.source.slice(1, -1)}/.+$`,
);

const complianceProviderRefSchema = z
	.string()
	.max(256)
	.refine(
		(ref) => catalogueProviderIds.has(ref) || customProviderRefRegex.test(ref),
		{ message: "Unknown provider" },
	);

const complianceModelRefSchema = z
	.string()
	.max(256)
	.refine(
		(ref) => catalogueModelIds.has(ref) || customModelRefRegex.test(ref),
		{
			message: "Unknown model",
		},
	);

// Define schemas directly with Zod instead of using createSelectSchema
const providerCompliancePolicySchema = z.object({
	enabled: z.boolean(),
	requireSoc2: z.boolean().optional(),
	requireSoc2Type2: z.boolean().optional(),
	requireIso27001: z.boolean().optional(),
	requireSoc2OrIso27001: z.boolean().optional(),
	requireGdpr: z.boolean().optional(),
	blockApiTraining: z.boolean().optional(),
	blockPromptLogging: z.boolean().optional(),
	blockStealthProviders: z.boolean().optional(),
	allowedCountries: z
		.array(
			z.string().refine((code) => providerCountryCodes.has(code), {
				message: "Unsupported provider headquarters country",
			}),
		)
		.optional(),
	blockedProviders: z.array(complianceProviderRefSchema).max(500).optional(),
	allowedProviders: z.array(complianceProviderRefSchema).max(500).optional(),
	blockedModels: z.array(complianceModelRefSchema).max(500).optional(),
	allowedModels: z.array(complianceModelRefSchema).max(500).optional(),
});

const organizationSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	name: z.string(),
	logo: z.string().nullable(),
	billingEmail: z.string(),
	billingCompany: z.string().nullable(),
	billingAddress: z.string().nullable(),
	billingTaxId: z.string().nullable(),
	billingNotes: z.string().nullable(),
	credits: z.string(),
	plan: z.enum(["free", "pro", "enterprise"]),
	planExpiresAt: z.date().nullable(),
	// Start of the current plan term; null when it was never recorded.
	planStartedAt: z.date().nullable(),
	// Enterprise trial window. While `isTrialActive` is set, the trial end is
	// the date that decides whether the org keeps its enterprise features.
	isTrialActive: z.boolean(),
	trialStartDate: z.date().nullable(),
	trialEndDate: z.date().nullable(),
	// Manual seat-limit override; null = use the plan default.
	seats: z.number().nullable(),
	// Manual API-key-limit override; null = use the plan default.
	apiKeyLimit: z.number().nullable(),
	// Manual project-limit override; null = use the plan default.
	projectLimit: z.number().nullable(),
	retentionLevel: z.enum(["retain", "none"]),
	providerCompliancePolicy: providerCompliancePolicySchema.nullable(),
	ssoAutoJoinDomain: z.string().nullable(),
	status: z.enum(["active", "inactive", "deleted"]).nullable(),
	autoTopUpEnabled: z.boolean(),
	autoTopUpThreshold: z.string().nullable(),
	autoTopUpAmount: z.string().nullable(),
	referralEarnings: z.string(),
	referralBonusEnabled: z.boolean(),
	referralBonusPercent: z.string(),
	// Organization kind: "default" (regular dashboard org), "devpass" (per-user
	// Dev Plans org), or "chat" (per-user lounge.llmgateway.io org).
	kind: z.enum(["default", "chat", "devpass"]),
	devPlan: z.enum(["none", "lite", "pro", "max"]),
	devPlanCycle: z.enum(["monthly", "annual"]),
	devPlanCreditsUsed: z.string(),
	devPlanCreditsLimit: z.string(),
	devPlanPremiumCreditsUsed: z.string(),
	devPlanPremiumWeekStart: z.date().nullable(),
	devPlanResetPassesLite: z.number(),
	devPlanResetPassesPro: z.number(),
	devPlanResetPassesMax: z.number(),
	devPlanIncludedResetPassesUsed: z.number(),
	devPlanBillingCycleStart: z.date().nullable(),
	devPlanExpiresAt: z.date().nullable(),
	devPlanServiceTier: z.enum(["default", "flex"]),
	devPlanPaygEnabled: z.boolean(),
	devPlanBillingOverride: z.boolean(),
	// Chat Plans fields
	chatPlan: z.enum(["none", "starter", "plus", "pro"]),
	chatPlanCycle: z.enum(["monthly"]),
	chatPlanCreditsUsed: z.string(),
	chatPlanCreditsLimit: z.string(),
	chatPlanBillingCycleStart: z.date().nullable(),
	chatPlanExpiresAt: z.date().nullable(),
	// Org-wide default developer budget (managed on the Teams page).
	defaultDeveloperMaxApiKeys: z.number().nullable(),
	defaultDeveloperUsageLimit: z.string().nullable(),
	defaultDeveloperPeriodUsageLimit: z.string().nullable(),
	defaultDeveloperPeriodUsageDurationValue: z.number().nullable(),
	defaultDeveloperPeriodUsageDurationUnit: z
		.enum(["hour", "day", "week", "month"])
		.nullable(),
	// The authenticated user's role in this org. Populated by GET /orgs so the
	// dashboard can gate org-level UI (e.g. hide org nav from project-scoped
	// "developer" members). Omitted by single-org endpoints.
	role: z.enum(["owner", "admin", "developer"]).optional(),
	enterpriseAccess: z.boolean().optional(),
});

const projectSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	name: z.string(),
	organizationId: z.string(),
	cachingEnabled: z.boolean(),
	cacheDurationSeconds: z.number(),
	providerCacheControlMode: providerCacheControlModeSchema,
	mode: z.enum(["api-keys", "credits", "hybrid"]),
	defaultRoutingStrategy: z.enum(["auto", "price", "throughput", "latency"]),
	status: z.enum(["active", "inactive", "deleted"]).nullable(),
	paymentsSdkEnabled: z.boolean(),
	endUserEnabled: z.boolean(),
	endUserMarkupPercent: z.string(),
	endUserTopUpBonusPercent: z.string(),
	allowedOrigins: z.array(z.string()).nullable(),
});

const createOrganizationSchema = z.object({
	name: z.string().min(1).max(255),
});

// Logos are stored inline as small base64 data URLs (no object storage).
// Raster formats only — SVG is rejected since it can embed active content.
// 256KB of base64 (~190KB binary) is far above what the client-side resize
// produces, so the cap only guards against abuse.
const LOGO_MAX_CHARS = 256 * 1024;
const LOGO_DATA_URL_REGEX =
	/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

const updateOrganizationSchema = z.object({
	name: z.string().min(1).max(255).optional(),
	logo: z
		.string()
		.max(LOGO_MAX_CHARS)
		.regex(LOGO_DATA_URL_REGEX, {
			message: "Logo must be a base64 data URL of a PNG, JPEG or WebP image",
		})
		.nullable()
		.optional(),
	billingEmail: z.string().email().optional(),
	billingCompany: z.string().optional(),
	billingAddress: z.string().optional(),
	billingTaxId: z.string().optional(),
	billingNotes: z.string().optional(),
	retentionLevel: z.enum(["retain", "none"]).optional(),
	providerCompliancePolicy: providerCompliancePolicySchema
		.nullable()
		.optional(),
	ssoAutoJoinDomain: z.string().max(253).nullable().optional(),
	autoTopUpEnabled: z.boolean().optional(),
	autoTopUpThreshold: z.number().min(5).optional(),
	autoTopUpAmount: z
		.number()
		.int()
		.min(10)
		.max(CREDIT_TOP_UP_MAX_AMOUNT)
		.optional(),
});

const AUTO_TOP_UP_AUDIT_FIELDS = [
	"autoTopUpEnabled",
	"autoTopUpThreshold",
	"autoTopUpAmount",
] as const;

const refundEligibilitySchema = z.object({
	eligible: z.boolean(),
	reason: z
		.enum([
			"unsupported_type",
			"not_completed",
			"already_refunded",
			"window_expired",
			"not_owner",
			"not_latest_purchase",
			"plan_inactive",
			"usage_exceeded",
			"pass_already_used",
		])
		.optional(),
});

const transactionSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	organizationId: z.string(),
	type: z.enum([
		"subscription_start",
		"subscription_cancel",
		"subscription_end",
		"credit_topup",
		"credit_refund",
		"credit_gift",
		"credit_manual_payment",
		"enterprise_license_fee",
		"dev_plan_start",
		"dev_plan_upgrade",
		"dev_plan_downgrade",
		"dev_plan_cancel",
		"dev_plan_resume",
		"dev_plan_end",
		"dev_plan_renewal",
		"dev_plan_reset_pass",
		"dev_plan_reset_pass_reward",
		"dev_plan_reset_pass_gift",
		"chat_plan_start",
		"chat_plan_upgrade",
		"chat_plan_downgrade",
		"chat_plan_cancel",
		"chat_plan_resume",
		"chat_plan_end",
		"chat_plan_renewal",
		"end_user_topup",
		"end_user_margin_accrual",
		"end_user_refund",
		"end_user_margin_payout",
		"end_user_bonus",
	]),
	amount: z.string().nullable(),
	creditAmount: z.string().nullable(),
	currency: z.string(),
	status: z.enum(["pending", "completed", "failed"]),
	stripePaymentIntentId: z.string().nullable(),
	stripeInvoiceId: z.string().nullable(),
	description: z.string().nullable(),
	relatedTransactionId: z.string().nullable(),
	refundReason: z.string().nullable(),
	// Self-refund eligibility, present only on refund-candidate purchase types.
	refund: refundEligibilitySchema.optional(),
});

const getOrganizations = createRoute({
	method: "get",
	path: "/",
	request: {
		query: z.object({
			includePersonal: z.enum(["true", "false"]).optional().openapi({
				description:
					"Include personal organizations. Used by the chat/devpass surfaces where plans live on the personal org. Defaults to hiding them from the regular dashboard.",
			}),
			includeChat: z.enum(["true", "false"]).optional().openapi({
				description:
					"Include the dedicated Chat organization. Used by the playground where the chat plan + credits live. Defaults to hiding it from the regular dashboard.",
			}),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						organizations: z.array(organizationSchema).openapi({}),
					}),
				},
			},
			description: "List of organizations the user belongs to",
		},
	},
});

organization.openapi(getOrganizations, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const userOrganizations = await db.query.userOrganization.findMany({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

	const { includePersonal, includeChat } = c.req.valid("query");

	let organizations = userOrganizations
		.map((uo) => ({
			...uo.organization!,
			role: uo.role,
			enterpriseAccess: hasOrganizationEnterpriseAccess(
				uo.organization?.id,
				uo.organization?.plan,
			),
		}))
		.filter((org) => org.status !== "deleted")
		// Personal and chat orgs are hidden from the regular dashboard. The
		// devpass/playground surfaces opt in via ?includePersonal=true /
		// ?includeChat=true since their plans + credits live on those orgs.
		.filter((org) => includePersonal === "true" || org.kind !== "devpass")
		.filter((org) => includeChat === "true" || org.kind !== "chat");

	if (organizations.length === 0) {
		const defaultOrganization = await getOrCreateDefaultOrganization({
			id: user.id,
			email: user.email,
		});

		if (
			defaultOrganization.status !== "deleted" &&
			defaultOrganization.kind !== "devpass"
		) {
			organizations = [
				{
					...defaultOrganization,
					role: "owner" as const,
					enterpriseAccess: hasOrganizationEnterpriseAccess(
						defaultOrganization.id,
						defaultOrganization.plan,
					),
				},
			];
		}
	}

	return c.json({
		organizations,
	});
});

const getProjects = createRoute({
	method: "get",
	path: "/{id}/projects",
	request: {
		params: z.object({
			id: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						projects: z.array(projectSchema).openapi({}),
					}),
				},
			},
			description: "List of projects for the specified organization",
		},
	},
});

organization.openapi(getProjects, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id } = c.req.param();

	const hasAccess = await userHasOrganizationAccess(user.id, id);
	if (!hasAccess) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	// RBAC: project-scoped "developer" members only see the projects granted to
	// them; owners/admins see every project in the org.
	const accessibleProjectIds = new Set(await getUserProjectIds(user.id));

	const projects = await db.query.project.findMany({
		where: {
			organizationId: {
				eq: id,
			},
			status: {
				ne: "deleted",
			},
		},
	});

	return c.json({
		projects: projects.filter((project) =>
			accessibleProjectIds.has(project.id),
		),
	});
});

const createOrganization = createRoute({
	method: "post",
	path: "/",
	request: {
		body: {
			content: {
				"application/json": {
					schema: createOrganizationSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						organization: organizationSchema.openapi({}),
					}),
				},
			},
			description: "Organization created successfully.",
		},
	},
});

organization.openapi(createOrganization, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { name } = c.req.valid("json");

	// Get user's existing organizations to check limits
	const userOrganizations = await db.query.userOrganization.findMany({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

	// Filter out deleted organizations
	const activeOrganizations = userOrganizations
		.filter((uo) => uo.organization?.status !== "deleted")
		.map((uo) => uo.organization!);

	const orgsLimit = 3;

	// If user only has free plan, they can have only 1 organization
	if (activeOrganizations.length >= orgsLimit) {
		throw new HTTPException(403, {
			message: `You have reached the limit of ${orgsLimit} organizations. Please reach out to support to increase this limit.`,
		});
	}

	const [newOrganization] = await db
		.insert(tables.organization)
		.values({
			name,
			billingEmail: user.email,
			// A flagged user cannot escape the block by creating a fresh org.
			riskFlagged: await isUserHighRisk(user.id),
		})
		.returning();

	await db.insert(tables.userOrganization).values({
		userId: user.id,
		organizationId: newOrganization.id,
		role: "owner",
	});

	await db.insert(tables.project).values({
		name: "Default Project",
		organizationId: newOrganization.id,
		mode: "hybrid",
	});

	await logAuditEvent({
		organizationId: newOrganization.id,
		userId: user.id,
		action: "organization.create",
		resourceType: "organization",
		resourceId: newOrganization.id,
		metadata: { resourceName: name },
	});

	return c.json({
		organization: newOrganization,
	});
});

const updateOrganization = createRoute({
	method: "patch",
	path: "/{id}",
	request: {
		params: z.object({
			id: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: updateOrganizationSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
						organization: organizationSchema.openapi({}),
					}),
				},
			},
			description: "Organization updated successfully.",
		},
		401: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Unauthorized.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Organization not found.",
		},
	},
});

organization.openapi(updateOrganization, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id } = c.req.param();
	const {
		name,
		logo,
		billingEmail,
		billingCompany,
		billingAddress,
		billingTaxId,
		billingNotes,
		retentionLevel,
		providerCompliancePolicy,
		ssoAutoJoinDomain,
		autoTopUpEnabled,
		autoTopUpThreshold,
		autoTopUpAmount,
	} = c.req.valid("json");

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: {
				eq: user.id,
			},
			organizationId: {
				eq: id,
			},
		},
		with: {
			organization: true,
		},
	});

	if (
		!userOrganization ||
		userOrganization.organization?.status === "deleted"
	) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	// Check if user is trying to update policies or billing settings
	const isBillingOrPolicyUpdate =
		billingEmail !== undefined ||
		billingCompany !== undefined ||
		billingAddress !== undefined ||
		billingTaxId !== undefined ||
		billingNotes !== undefined ||
		retentionLevel !== undefined ||
		autoTopUpEnabled !== undefined ||
		autoTopUpThreshold !== undefined ||
		autoTopUpAmount !== undefined;

	// Only owners can update billing and policy settings
	if (isBillingOrPolicyUpdate && userOrganization.role !== "owner") {
		throw new HTTPException(403, {
			message: "Only owners can update billing and policy settings",
		});
	}

	// DevPass and Chat organizations never retain request/response payloads, and
	// the products expose no setting for it. Reject attempts to turn it on.
	if (
		retentionLevel !== undefined &&
		userOrganization.organization?.kind !== "default"
	) {
		throw new HTTPException(400, {
			message: "Data retention is not available for this organization",
		});
	}

	// DevPass accepts only the no-API-training requirement, regardless of plan.
	// Other organizations retain the enterprise gate for enabling a policy.
	if (providerCompliancePolicy !== undefined) {
		if (
			userOrganization.role !== "owner" &&
			userOrganization.role !== "admin"
		) {
			throw new HTTPException(403, {
				message: "Only owners and admins can manage compliance policies",
			});
		}
		if (
			userOrganization.organization?.kind === "devpass" &&
			providerCompliancePolicy !== null
		) {
			const unsupportedKeys = Object.entries(providerCompliancePolicy)
				.filter(([key, value]) => {
					if (key === "enabled" || key === "blockApiTraining") {
						return false;
					}
					return Array.isArray(value) ? value.length > 0 : Boolean(value);
				})
				.map(([key]) => key);

			if (unsupportedKeys.length > 0) {
				throw new HTTPException(403, {
					message: `DevPass compliance settings only support blockApiTraining; unsupported settings: ${unsupportedKeys.join(", ")}`,
				});
			}
		} else if (
			// Clearing or disabling a policy stays allowed without enterprise
			// access: the gateway enforces any enabled stored policy fail-closed,
			// so a downgraded org must be able to turn a leftover policy off.
			providerCompliancePolicy !== null &&
			providerCompliancePolicy.enabled &&
			!hasOrganizationEnterpriseAccess(
				userOrganization.organization?.id,
				userOrganization.organization?.plan,
			)
		) {
			throw new HTTPException(403, {
				message: "Provider compliance policies require an enterprise plan",
			});
		}
	}

	// Google SSO domain auto-join is an enterprise feature managed by owners and
	// admins. The value is normalized and validated before storage.
	let normalizedSsoDomain: string | null | undefined;
	if (ssoAutoJoinDomain !== undefined) {
		if (
			!hasOrganizationEnterpriseAccess(
				userOrganization.organization?.id,
				userOrganization.organization?.plan,
			)
		) {
			throw new HTTPException(403, {
				message: "SSO auto-join requires an enterprise plan",
			});
		}
		if (
			userOrganization.role !== "owner" &&
			userOrganization.role !== "admin"
		) {
			throw new HTTPException(403, {
				message: "Only owners and admins can configure SSO auto-join",
			});
		}
		if (ssoAutoJoinDomain === null || ssoAutoJoinDomain.trim() === "") {
			normalizedSsoDomain = null;
		} else {
			const normalized = normalizeDomain(ssoAutoJoinDomain);
			if (!isConfigurableDomain(normalized)) {
				throw new HTTPException(400, {
					message:
						"Invalid or disallowed domain. Use a corporate domain like acme.com (consumer email domains are not allowed).",
				});
			}
			normalizedSsoDomain = normalized;
		}
	}

	const updateData: any = {};
	if (name !== undefined) {
		updateData.name = name;
	}
	if (logo !== undefined) {
		updateData.logo = logo;
	}
	if (billingEmail !== undefined) {
		updateData.billingEmail = billingEmail;
	}
	if (billingCompany !== undefined) {
		updateData.billingCompany = billingCompany;
	}
	if (billingAddress !== undefined) {
		updateData.billingAddress = billingAddress;
	}
	if (billingTaxId !== undefined) {
		updateData.billingTaxId = billingTaxId;
	}
	if (billingNotes !== undefined) {
		updateData.billingNotes = billingNotes;
	}
	if (retentionLevel !== undefined) {
		updateData.retentionLevel = retentionLevel;
	}
	if (providerCompliancePolicy !== undefined) {
		updateData.providerCompliancePolicy = providerCompliancePolicy;
	}
	if (normalizedSsoDomain !== undefined) {
		updateData.ssoAutoJoinDomain = normalizedSsoDomain;
	}
	if (autoTopUpEnabled !== undefined) {
		updateData.autoTopUpEnabled = autoTopUpEnabled;
		if (autoTopUpEnabled && !userOrganization.organization?.autoTopUpEnabled) {
			updateData.paymentFailureCount = 0;
			updateData.lastPaymentFailureAt = null;
			updateData.paymentFailureStartedAt = null;
		}
	}
	if (autoTopUpThreshold !== undefined) {
		updateData.autoTopUpThreshold = autoTopUpThreshold.toString();
	}
	if (autoTopUpAmount !== undefined) {
		updateData.autoTopUpAmount = autoTopUpAmount.toString();
	}

	// An empty PATCH body is a valid no-op; drizzle throws "No values to set"
	// on an empty update, so skip the query and return the org unchanged.
	let updatedOrganization;
	if (Object.keys(updateData).length === 0) {
		updatedOrganization = userOrganization.organization!;
	} else {
		try {
			// Cached client so gateway policy gates see compliance changes
			// immediately instead of serving the previous organization row.
			[updatedOrganization] = await cdb
				.update(tables.organization)
				.set(updateData)
				.where(eq(tables.organization.id, id))
				.returning();
		} catch (err) {
			const code =
				(err as { code?: string; cause?: { code?: string } })?.code ??
				(err as { cause?: { code?: string } })?.cause?.code;
			if (code === "23505" && normalizedSsoDomain) {
				throw new HTTPException(409, {
					message: "This domain is already configured by another organization.",
				});
			}
			throw err;
		}
	}

	// Build changes metadata for audit log
	const changes: Record<string, { old: unknown; new: unknown }> = {};
	const autoTopUpChanges: Record<string, { old: unknown; new: unknown }> = {};
	const oldOrg = userOrganization.organization!;
	if (name !== undefined && name !== oldOrg.name) {
		changes.name = { old: oldOrg.name, new: name };
	}
	// Audit only the presence transition — base64 image data would bloat the log.
	if (logo !== undefined && logo !== oldOrg.logo) {
		changes.logo = {
			old: oldOrg.logo ? "(image)" : null,
			new: logo ? "(image)" : null,
		};
	}
	if (billingEmail !== undefined && billingEmail !== oldOrg.billingEmail) {
		changes.billingEmail = { old: oldOrg.billingEmail, new: billingEmail };
	}
	if (
		billingCompany !== undefined &&
		billingCompany !== oldOrg.billingCompany
	) {
		changes.billingCompany = {
			old: oldOrg.billingCompany,
			new: billingCompany,
		};
	}
	if (
		billingAddress !== undefined &&
		billingAddress !== oldOrg.billingAddress
	) {
		changes.billingAddress = {
			old: oldOrg.billingAddress,
			new: billingAddress,
		};
	}
	if (billingTaxId !== undefined && billingTaxId !== oldOrg.billingTaxId) {
		changes.billingTaxId = { old: oldOrg.billingTaxId, new: billingTaxId };
	}
	if (billingNotes !== undefined && billingNotes !== oldOrg.billingNotes) {
		changes.billingNotes = { old: oldOrg.billingNotes, new: billingNotes };
	}
	if (
		retentionLevel !== undefined &&
		retentionLevel !== oldOrg.retentionLevel
	) {
		changes.retentionLevel = {
			old: oldOrg.retentionLevel,
			new: retentionLevel,
		};
	}
	if (
		providerCompliancePolicy !== undefined &&
		JSON.stringify(oldOrg.providerCompliancePolicy ?? null) !==
			JSON.stringify(providerCompliancePolicy ?? null)
	) {
		changes.providerCompliancePolicy = {
			old: oldOrg.providerCompliancePolicy,
			new: providerCompliancePolicy,
		};
	}
	if (
		autoTopUpEnabled !== undefined &&
		autoTopUpEnabled !== oldOrg.autoTopUpEnabled
	) {
		autoTopUpChanges.autoTopUpEnabled = {
			old: oldOrg.autoTopUpEnabled,
			new: autoTopUpEnabled,
		};
	}
	if (
		autoTopUpThreshold !== undefined &&
		autoTopUpThreshold.toString() !== oldOrg.autoTopUpThreshold
	) {
		autoTopUpChanges.autoTopUpThreshold = {
			old: oldOrg.autoTopUpThreshold,
			new: autoTopUpThreshold.toString(),
		};
	}
	if (
		autoTopUpAmount !== undefined &&
		autoTopUpAmount.toString() !== oldOrg.autoTopUpAmount
	) {
		autoTopUpChanges.autoTopUpAmount = {
			old: oldOrg.autoTopUpAmount,
			new: autoTopUpAmount.toString(),
		};
	}

	const organizationChanges = Object.fromEntries(
		Object.entries(changes).filter(
			([field]) =>
				!AUTO_TOP_UP_AUDIT_FIELDS.includes(
					field as (typeof AUTO_TOP_UP_AUDIT_FIELDS)[number],
				),
		),
	);

	if (Object.keys(organizationChanges).length > 0) {
		await logAuditEvent({
			organizationId: id,
			userId: user.id,
			action: "organization.update",
			resourceType: "organization",
			resourceId: id,
			metadata: { changes: organizationChanges },
		});
	}

	if (Object.keys(autoTopUpChanges).length > 0) {
		await logAuditEvent({
			organizationId: id,
			userId: user.id,
			action: "payment.auto_topup.update",
			resourceType: "organization",
			resourceId: id,
			metadata: { changes: autoTopUpChanges },
		});
	}

	if (
		normalizedSsoDomain !== undefined &&
		normalizedSsoDomain !== oldOrg.ssoAutoJoinDomain
	) {
		await logAuditEvent({
			organizationId: id,
			userId: user.id,
			action: "organization.sso_auto_join.update",
			resourceType: "organization",
			resourceId: id,
			metadata: {
				changes: {
					ssoAutoJoinDomain: {
						old: oldOrg.ssoAutoJoinDomain,
						new: normalizedSsoDomain,
					},
				},
			},
		});
	}

	return c.json({
		message: "Organization updated successfully",
		organization: updatedOrganization,
	});
});

const deleteOrganization = createRoute({
	method: "delete",
	path: "/{id}",
	request: {
		params: z.object({
			id: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Organization deleted successfully.",
		},
		401: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Unauthorized.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Organization not found.",
		},
	},
});

organization.openapi(deleteOrganization, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id } = c.req.param();

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: {
				eq: user.id,
			},
			organizationId: {
				eq: id,
			},
		},
		with: {
			organization: true,
		},
	});

	if (
		!userOrganization ||
		userOrganization.organization?.status === "deleted"
	) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	// Block deletion of personal orgs - they are managed via dev plans
	if (userOrganization.organization?.kind === "devpass") {
		throw new HTTPException(403, {
			message:
				"Personal organizations cannot be deleted. Please cancel your dev plan at devpass.llmgateway.io instead.",
		});
	}

	// Block deletion of the dedicated Chat org - it is managed via chat plans
	if (userOrganization.organization?.kind === "chat") {
		throw new HTTPException(403, {
			message:
				"The Chat organization cannot be deleted. Please cancel your chat plan from the lounge.llmgateway.io pricing page instead.",
		});
	}

	await db
		.update(tables.organization)
		.set({
			status: "deleted",
		})
		.where(eq(tables.organization.id, id));

	await logAuditEvent({
		organizationId: id,
		userId: user.id,
		action: "organization.delete",
		resourceType: "organization",
		resourceId: id,
		metadata: { resourceName: userOrganization.organization?.name },
	});

	return c.json({
		message: "Organization deleted successfully",
	});
});

const getTransactions = createRoute({
	method: "get",
	path: "/{id}/transactions",
	request: {
		params: z.object({
			id: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						transactions: z.array(transactionSchema).openapi({}),
					}),
				},
			},
			description: "List of transactions for the specified organization",
		},
	},
});

organization.openapi(getTransactions, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id } = c.req.param();

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: user.id },
			organizationId: { eq: id },
		},
		with: {
			organization: true,
		},
	});
	if (!userOrganization?.organization) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	const transactions = await db.query.transaction.findMany({
		where: {
			organizationId: {
				eq: id,
			},
		},
		orderBy: {
			createdAt: "desc",
		},
	});

	const org = userOrganization.organization;
	return c.json({
		transactions: transactions.map((t) =>
			isSelfRefundCandidateType(t.type)
				? {
						...t,
						refund: computeSelfRefundEligibility({
							organization: org,
							role: userOrganization.role,
							transactions,
							transaction: t,
						}),
					}
				: t,
		),
	});
});

const selfRefundTransaction = createRoute({
	method: "post",
	path: "/{id}/transactions/{transactionId}/refund",
	request: {
		params: z.object({
			id: z.string(),
			transactionId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: refundFeedbackBodySchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						status: z.literal("refund_processing"),
						stripeRefundId: z.string(),
					}),
				},
			},
			description:
				"Refund created; the transaction and credit adjustments are applied when Stripe confirms via webhook",
		},
	},
});

organization.openapi(selfRefundTransaction, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id, transactionId } = c.req.param();
	const { reason, comments } = c.req.valid("json");

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: user.id },
			organizationId: { eq: id },
		},
		with: {
			organization: true,
		},
	});
	if (!userOrganization?.organization) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	const transactions = await db.query.transaction.findMany({
		where: {
			organizationId: { eq: id },
		},
	});
	const transaction = transactions.find((t) => t.id === transactionId);
	if (!transaction) {
		throw new HTTPException(404, {
			message: "Transaction not found",
		});
	}

	const eligibility = computeSelfRefundEligibility({
		organization: userOrganization.organization,
		role: userOrganization.role,
		transactions,
		transaction,
	});
	if (!eligibility.eligible) {
		if (eligibility.reason === "not_owner") {
			throw new HTTPException(403, {
				message: "Only the organization owner can request a refund",
			});
		}
		throw new HTTPException(400, {
			message: `This transaction is not eligible for a self-service refund: ${eligibility.reason}`,
		});
	}

	const { stripeRefundId } = await executeSelfRefund({
		organization: userOrganization.organization,
		transaction,
		userId: user.id,
		reason,
		comments,
	});

	return c.json({
		status: "refund_processing" as const,
		stripeRefundId,
	});
});

const downloadTransactionInvoice = createRoute({
	method: "get",
	path: "/{id}/transactions/{transactionId}/invoice",
	request: {
		params: z.object({
			id: z.string(),
			transactionId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/pdf": {
					schema: z.any().openapi({ type: "string", format: "binary" }),
				},
			},
			description: "PDF invoice for the specified transaction",
		},
	},
});

organization.openapi(downloadTransactionInvoice, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id, transactionId } = c.req.param();

	const hasAccess = await userHasOrganizationAccess(user.id, id);
	if (!hasAccess) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	const transaction = await db.query.transaction.findFirst({
		where: {
			id: { eq: transactionId },
			organizationId: { eq: id },
		},
	});
	if (!transaction) {
		throw new HTTPException(404, {
			message: "Transaction not found",
		});
	}
	if (!isInvoiceableTransaction(transaction)) {
		throw new HTTPException(400, {
			message: "No invoice is available for this transaction",
		});
	}

	const org = await db.query.organization.findFirst({
		where: {
			id: { eq: id },
		},
	});
	if (!org) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const originalTransaction =
		isRefundTransaction(transaction.type) && transaction.relatedTransactionId
			? await db.query.transaction.findFirst({
					where: {
						id: { eq: transaction.relatedTransactionId },
						organizationId: { eq: id },
					},
				})
			: null;

	const pdf = generateInvoicePDF(
		buildInvoiceDataForTransaction(transaction, org, originalTransaction),
	);

	const prefix = isRefundTransaction(transaction.type)
		? "credit-note"
		: "invoice";
	c.header("Content-Type", "application/pdf");
	c.header(
		"Content-Disposition",
		`attachment; filename="${prefix}-${transaction.id}.pdf"`,
	);
	return c.body(new Uint8Array(pdf));
});

const getReferralStats = createRoute({
	method: "get",
	path: "/{id}/referral-stats",
	request: {
		params: z.object({
			id: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						referredCount: z.number(),
					}),
				},
			},
			description: "Referral statistics for the organization",
		},
	},
});

organization.openapi(getReferralStats, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id } = c.req.param();

	const hasAccess = await userHasOrganizationAccess(user.id, id);
	if (!hasAccess) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	const referrals = await db.query.referral.findMany({
		where: {
			referrerOrganizationId: {
				eq: id,
			},
		},
	});

	return c.json({
		referredCount: referrals.length,
	});
});

const discountSchema = z.object({
	id: z.string(),
	organizationId: z.string().nullable(),
	provider: z.string().nullable(),
	model: z.string().nullable(),
	discountPercent: z.string(),
	reason: z.string().nullable(),
	expiresAt: z.date().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

const getOrgDiscounts = createRoute({
	method: "get",
	path: "/{id}/discounts",
	request: {
		params: z.object({
			id: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						orgDiscounts: z.array(discountSchema).openapi({}),
						globalDiscounts: z.array(discountSchema).openapi({}),
					}),
				},
			},
			description:
				"Active discounts for the organization (org-specific and global)",
		},
	},
});

organization.openapi(getOrgDiscounts, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id } = c.req.param();

	const hasAccess = await userHasOrganizationAccess(user.id, id);
	if (!hasAccess) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	const now = new Date();
	const notExpired = or(
		isNull(tables.discount.expiresAt),
		gte(tables.discount.expiresAt, now),
	);

	const [orgDiscounts, globalDiscounts] = await Promise.all([
		db
			.select()
			.from(tables.discount)
			.where(and(eq(tables.discount.organizationId, id), notExpired))
			.orderBy(desc(tables.discount.createdAt)),
		db
			.select()
			.from(tables.discount)
			.where(and(isNull(tables.discount.organizationId), notExpired))
			.orderBy(desc(tables.discount.createdAt)),
	]);

	return c.json({
		orgDiscounts,
		globalDiscounts,
	});
});

// ─── Credits Runway ──────────────────────────────────────────────────────────

const getCreditsRunway = createRoute({
	method: "get",
	path: "/{id}/credits-runway",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						avgDailySpend7d: z.number(),
						runwayDays: z.number().nullable(),
						balance: z.number(),
					}),
				},
			},
			description: "Credits runway computed successfully",
		},
	},
});

organization.openapi(getCreditsRunway, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.param();
	const membership = await db.query.userOrganization.findFirst({
		where: { userId: { eq: user.id }, organizationId: { eq: id } },
	});
	if (!membership) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	// Runway aggregates spend across every project in the org, including ones a
	// developer was never granted, so it is owner/admin only. The dashboard hides
	// the credits widget from developers anyway.
	if (membership.role === "developer") {
		throw new HTTPException(403, {
			message: "Only organization owners and admins can view credits runway",
		});
	}

	const org = await db.query.organization.findFirst({
		where: { id: { eq: id } },
	});

	// A membership row outlives the organization it points at, so check the status
	// here as the other org-scoped reads do.
	if (!org || org.status === "deleted") {
		throw new HTTPException(404, { message: "Organization not found" });
	}

	const balance = Number(org.credits ?? 0);

	// Rolling 7-day average daily spend from projectHourlyStats
	// eslint-disable-next-line no-mixed-operators
	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

	// Only count spend that actually drains the credit balance: the worker debits
	// credits-mode rows at their full cost (billing_cost ?? cost, storage
	// excluded) and BYOK ("api-keys") rows at their data-storage cost only, so
	// blended `cost` would overstate the burn rate for BYOK-heavy orgs.
	const result = await db
		.select({
			totalCost: sql<number>`COALESCE(SUM(cast(${projectHourlyStats.creditsCost} as double precision)), 0) + COALESCE(SUM(cast(${projectHourlyStats.apiKeysDataStorageCost} as double precision)), 0)`,
		})
		.from(projectHourlyStats)
		.innerJoin(
			tables.project,
			eq(tables.project.id, projectHourlyStats.projectId),
		)
		.where(
			and(
				eq(tables.project.organizationId, id),
				gte(projectHourlyStats.hourTimestamp, sevenDaysAgo),
			),
		);

	const totalCost7d = Number(result[0]?.totalCost ?? 0);
	const avgDailySpend7d = totalCost7d / 7;

	let runwayDays: number | null = null;
	if (avgDailySpend7d > 0) {
		const raw = balance / avgDailySpend7d;
		runwayDays = raw > 30 ? 31 : Math.round(raw); // 31 = "30+"
	}

	return c.json({
		avgDailySpend7d: Math.round(avgDailySpend7d * 100) / 100,
		runwayDays,
		balance,
	});
});

const round2 = (n: number) => Math.round(n * 100) / 100;

const getOrganizationLimits = createRoute({
	method: "get",
	path: "/{id}/limits",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						// enterprise orgs have no gateway rate limits or spend caps at all
						enterprise: z.boolean(),
						planClass: z.enum(["regular", "dev", "chat"]),
						// False when GATEWAY_RATE_LIMITS_ENABLED=false: the endpoint RPM
						// table is not enforced platform-wide.
						rateLimitsApply: z.boolean(),
						// True when support pinned the tier; progression does not apply.
						tierOverridden: z.boolean(),
						// whether daily/monthly USD spend caps apply (regular PAYG orgs)
						capsApply: z.boolean(),
						plan: z.string(),
						accountAgeDays: z.number(),
						lifetimeSpendUsd: z.number(),
						tier: z.object({
							tier: z.number(),
							rpmMultiplier: z.number(),
							dailyCapUsd: z.number(),
							monthlyCapUsd: z.number(),
							topUpDailyCapUsd: z.number(),
						}),
						usage: z.object({
							dailySpentUsd: z.number(),
							monthlySpentUsd: z.number(),
						}),
						// Rolling-24h top-up allowance; null when the org is exempt.
						topUp: z
							.object({
								capUsd: z.number(),
								windowHours: z.number(),
								usedUsd: z.number(),
								remainingUsd: z.number(),
							})
							.nullable(),
						nextTier: z
							.object({
								tier: z.number(),
								rpmMultiplier: z.number(),
								dailyCapUsd: z.number(),
								monthlyCapUsd: z.number(),
								topUpDailyCapUsd: z.number(),
								ageDaysRequired: z.number(),
								spendUsdRequired: z.number(),
								daysUntilQualify: z.number(),
								spendUsdUntilQualify: z.number(),
								minAgeDaysRequired: z.number(),
								daysUntilSpendPathUnlocks: z.number(),
							})
							.nullable(),
						endpoints: z.array(
							z.object({
								key: z.string(),
								path: z.string(),
								rpm: z.number(),
							}),
						),
					}),
				},
			},
			description: "Organization rate-limit and spend-cap tier info",
		},
	},
});

organization.openapi(getOrganizationLimits, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.param();
	const membership = await db.query.userOrganization.findFirst({
		where: { userId: { eq: user.id }, organizationId: { eq: id } },
	});
	if (!membership) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}
	// Spend and org-wide caps are financial data, so developers (project-scoped
	// members) are excluded, mirroring the credits-runway endpoint.
	if (membership.role === "developer") {
		throw new HTTPException(403, {
			message: "Only organization owners and admins can view limits",
		});
	}

	const org = await db.query.organization.findFirst({
		where: { id: { eq: id } },
	});
	if (!org || org.status === "deleted") {
		throw new HTTPException(404, { message: "Organization not found" });
	}

	const enterprise = org.plan === "enterprise";
	// Mirror the enforcement kill switches: when caps are disabled platform-wide
	// the Limits page must not claim they apply.
	const capsApply = isCappedOrg(org) && isSpendCapEnabled();

	// Tier-qualifying spend: lifetime usage minus completed refunds, floored at
	// 0 — the same figure the gateway uses to resolve the trust tier, so the
	// dashboard shows exactly what the tier is computed from.
	const lifetimeSpendUsd = await getOrgTierQualifyingSpendUsd(id);

	const now = Date.now();
	const planClass = getPlanClass(org);
	const tier = getOrgSpendTier(org, lifetimeSpendUsd, now);
	const nextTier = getNextSpendTier(org, lifetimeSpendUsd, now);

	const [dailyRaw, monthlyRaw] = await redisClient.mget(
		spendDailyKey(id, now),
		spendMonthlyKey(id, now),
	);

	const accountAgeDays = Math.floor(
		(now - new Date(org.createdAt).getTime()) / 86_400_000,
	);

	// Entries sharing a key (the AI SDK spec-version prefixes) share one bucket
	// — show them once.
	const uniquePathConfigs = PATH_RATE_LIMITS.filter(
		(cfg, index) =>
			PATH_RATE_LIMITS.findIndex((c) => c.key === cfg.key) === index,
	);
	const endpoints = uniquePathConfigs.map((cfg) => {
		const base = getBaseLimit(cfg, planClass);
		// Only regular orgs get the spend-tier multiplier; dev/chat stay flat.
		const rpm =
			planClass === "regular" ? Math.floor(base * tier.rpmMultiplier) : base;
		return { key: cfg.key, path: cfg.prefix, rpm };
	});

	// Rolling-24h top-up allowance (windowed transaction sum + in-flight
	// reservations), shown only when the org is actually gated.
	let topUp: {
		capUsd: number;
		windowHours: number;
		usedUsd: number;
		remainingUsd: number;
	} | null = null;
	if (
		isTopUpVelocityEnabled() &&
		isTopUpVelocityGatedOrg(org) &&
		tier.topUpDailyCapUsd > 0
	) {
		const usage = await getTopUpVelocityUsage(id, now);
		const usedUsd = usage.dbSumUsd + usage.reservedUsd;
		topUp = {
			capUsd: tier.topUpDailyCapUsd,
			windowHours: 24,
			usedUsd: round2(usedUsd),
			remainingUsd: round2(Math.max(0, tier.topUpDailyCapUsd - usedUsd)),
		};
	}

	return c.json({
		enterprise,
		planClass,
		rateLimitsApply: isOrgRateLimitEnabled(),
		tierOverridden: resolveTrustTierOverride(org) !== null,
		capsApply,
		plan: org.plan,
		accountAgeDays,
		lifetimeSpendUsd: round2(lifetimeSpendUsd),
		tier: {
			tier: tier.tier,
			rpmMultiplier: tier.rpmMultiplier,
			dailyCapUsd: tier.dailyCapUsd,
			monthlyCapUsd: tier.monthlyCapUsd,
			topUpDailyCapUsd: tier.topUpDailyCapUsd,
		},
		usage: {
			dailySpentUsd: round2(Number(dailyRaw ?? 0) || 0),
			monthlySpentUsd: round2(Number(monthlyRaw ?? 0) || 0),
		},
		topUp,
		nextTier: nextTier
			? {
					tier: nextTier.tier,
					rpmMultiplier: nextTier.rpmMultiplier,
					dailyCapUsd: nextTier.dailyCapUsd,
					monthlyCapUsd: nextTier.monthlyCapUsd,
					topUpDailyCapUsd: nextTier.topUpDailyCapUsd,
					ageDaysRequired: nextTier.ageDaysRequired,
					spendUsdRequired: nextTier.spendUsdRequired,
					daysUntilQualify: nextTier.daysUntilQualify,
					spendUsdUntilQualify: round2(nextTier.spendUsdUntilQualify),
					minAgeDaysRequired: nextTier.minAgeDaysRequired,
					daysUntilSpendPathUnlocks: nextTier.daysUntilSpendPathUnlocks,
				}
			: null,
		endpoints,
	});
});

export default organization;
