import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	getUserProjectIds,
	userHasOrganizationAccess,
} from "@/utils/authorization.js";
import { getOrCreateDefaultOrganization } from "@/utils/default-org.js";

import { logAuditEvent } from "@llmgateway/audit";
import {
	and,
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
import { CREDIT_TOP_UP_MAX_AMOUNT } from "@llmgateway/shared";

import type { ServerTypes } from "@/vars.js";

export const organization = new OpenAPIHono<ServerTypes>();

// Define schemas directly with Zod instead of using createSelectSchema
const providerCompliancePolicySchema = z.object({
	enabled: z.boolean(),
	requireSoc2: z.boolean().optional(),
	requireIso27001: z.boolean().optional(),
	requireSoc2OrIso27001: z.boolean().optional(),
	requireGdpr: z.boolean().optional(),
	blockApiTraining: z.boolean().optional(),
	blockPromptLogging: z.boolean().optional(),
});

const organizationSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	name: z.string(),
	billingEmail: z.string(),
	billingCompany: z.string().nullable(),
	billingAddress: z.string().nullable(),
	billingTaxId: z.string().nullable(),
	billingNotes: z.string().nullable(),
	credits: z.string(),
	plan: z.enum(["free", "pro", "enterprise"]),
	planExpiresAt: z.date().nullable(),
	retentionLevel: z.enum(["retain", "none"]),
	providerCompliancePolicy: providerCompliancePolicySchema.nullable(),
	status: z.enum(["active", "inactive", "deleted"]).nullable(),
	autoTopUpEnabled: z.boolean(),
	autoTopUpThreshold: z.string().nullable(),
	autoTopUpAmount: z.string().nullable(),
	referralEarnings: z.string(),
	referralBonusEnabled: z.boolean(),
	referralBonusPercent: z.string(),
	// Organization kind: "default" (regular dashboard org), "devpass" (per-user
	// Dev Plans org), or "chat" (per-user chat.llmgateway.io org).
	kind: z.enum(["default", "chat", "devpass"]),
	devPlan: z.enum(["none", "lite", "pro", "max"]),
	devPlanCycle: z.enum(["monthly", "annual"]),
	devPlanCreditsUsed: z.string(),
	devPlanCreditsLimit: z.string(),
	devPlanPremiumCreditsUsed: z.string(),
	devPlanPremiumWeekStart: z.date().nullable(),
	devPlanBillingCycleStart: z.date().nullable(),
	devPlanExpiresAt: z.date().nullable(),
	devPlanAllowAllModels: z.boolean(),
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
});

const projectSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	name: z.string(),
	organizationId: z.string(),
	cachingEnabled: z.boolean(),
	cacheDurationSeconds: z.number(),
	providerCacheControlEnabled: z.boolean(),
	mode: z.enum(["api-keys", "credits", "hybrid"]),
	defaultRoutingStrategy: z.enum(["auto", "price", "throughput", "latency"]),
	status: z.enum(["active", "inactive", "deleted"]).nullable(),
	paymentsSdkEnabled: z.boolean(),
	endUserEnabled: z.boolean(),
	endUserMarkupPercent: z.string(),
	allowedOrigins: z.array(z.string()).nullable(),
});

const createOrganizationSchema = z.object({
	name: z.string().min(1).max(255),
});

const updateOrganizationSchema = z.object({
	name: z.string().min(1).max(255).optional(),
	billingEmail: z.string().email().optional(),
	billingCompany: z.string().optional(),
	billingAddress: z.string().optional(),
	billingTaxId: z.string().optional(),
	billingNotes: z.string().optional(),
	retentionLevel: z.enum(["retain", "none"]).optional(),
	providerCompliancePolicy: providerCompliancePolicySchema
		.nullable()
		.optional(),
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
		"end_user_topup",
		"end_user_margin_accrual",
		"end_user_refund",
		"end_user_margin_payout",
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
		.map((uo) => ({ ...uo.organization!, role: uo.role }))
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
			organizations = [{ ...defaultOrganization, role: "owner" as const }];
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
		billingEmail,
		billingCompany,
		billingAddress,
		billingTaxId,
		billingNotes,
		retentionLevel,
		providerCompliancePolicy,
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

	// Provider compliance policies are an enterprise feature managed by owners
	// and admins (matching the Guardrails settings page).
	if (providerCompliancePolicy !== undefined) {
		if (userOrganization.organization?.plan !== "enterprise") {
			throw new HTTPException(403, {
				message: "Provider compliance policies require an enterprise plan",
			});
		}
		if (
			userOrganization.role !== "owner" &&
			userOrganization.role !== "admin"
		) {
			throw new HTTPException(403, {
				message: "Only owners and admins can manage compliance policies",
			});
		}
	}

	const updateData: any = {};
	if (name !== undefined) {
		updateData.name = name;
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

	const [updatedOrganization] = await db
		.update(tables.organization)
		.set(updateData)
		.where(eq(tables.organization.id, id))
		.returning();

	// Build changes metadata for audit log
	const changes: Record<string, { old: unknown; new: unknown }> = {};
	const autoTopUpChanges: Record<string, { old: unknown; new: unknown }> = {};
	const oldOrg = userOrganization.organization!;
	if (name !== undefined && name !== oldOrg.name) {
		changes.name = { old: oldOrg.name, new: name };
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
				"The Chat organization cannot be deleted. Please cancel your chat plan from the chat.llmgateway.io pricing page instead.",
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

	const hasAccess = await userHasOrganizationAccess(user.id, id);
	if (!hasAccess) {
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

	return c.json({
		transactions,
	});
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
	const hasAccess = await userHasOrganizationAccess(user.id, id);
	if (!hasAccess) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	const org = await db.query.organization.findFirst({
		where: { id: { eq: id } },
	});

	if (!org) {
		throw new HTTPException(404, { message: "Organization not found" });
	}

	const balance = Number(org.credits ?? 0);

	// Rolling 7-day average daily spend from projectHourlyStats
	// eslint-disable-next-line no-mixed-operators
	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

	const result = await db
		.select({
			totalCost: sql<number>`COALESCE(SUM(${projectHourlyStats.cost}), 0)`,
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

export default organization;
