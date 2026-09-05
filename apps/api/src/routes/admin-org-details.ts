import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { Decimal } from "decimal.js";
import { HTTPException } from "hono/http-exception";
import Stripe from "stripe";
import { z } from "zod";

import { adminMiddleware } from "@/middleware/admin.js";
import { getStripe } from "@/routes/payments.js";
import { findDevPlanCardFingerprintOwner } from "@/utils/dev-plan-card-fingerprints.js";

import { logAuditEvent } from "@llmgateway/audit";
import {
	and,
	auditLogActions,
	auditLogResourceTypes,
	db,
	desc,
	eq,
	gte,
	sql,
	tables,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const adminOrgDetails = new OpenAPIHono<ServerTypes>();

adminOrgDetails.use("/*", adminMiddleware);

async function requireOrganization(orgId: string) {
	const org = await db.query.organization.findFirst({
		where: {
			id: { eq: orgId },
		},
	});

	if (!org) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	return org;
}

// ==================== Audit Logs ====================

const auditLogEntrySchema = z.object({
	id: z.string(),
	createdAt: z.string(),
	userId: z.string(),
	action: z.string(),
	resourceType: z.string(),
	resourceId: z.string().nullable(),
	metadata: z.unknown().nullable(),
	user: z
		.object({
			id: z.string(),
			email: z.string(),
			name: z.string().nullable(),
		})
		.nullable(),
});

const getOrganizationAuditLogs = createRoute({
	method: "get",
	path: "/organizations/{orgId}/audit-logs",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
		query: z.object({
			limit: z.coerce.number().min(1).max(100).default(25).optional(),
			offset: z.coerce.number().min(0).default(0).optional(),
			action: z.string().optional(),
			resourceType: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						auditLogs: z.array(auditLogEntrySchema),
						total: z.number(),
						limit: z.number(),
						offset: z.number(),
						filters: z.object({
							actions: z.array(z.string()),
							resourceTypes: z.array(z.string()),
						}),
					}),
				},
			},
			description: "Audit logs for the organization.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

adminOrgDetails.openapi(getOrganizationAuditLogs, async (c) => {
	const { orgId } = c.req.valid("param");
	const query = c.req.valid("query");
	const limit = query.limit ?? 25;
	const offset = query.offset ?? 0;

	await requireOrganization(orgId);

	const whereConditions = [eq(tables.auditLog.organizationId, orgId)];

	if (
		query.action &&
		auditLogActions.includes(query.action as (typeof auditLogActions)[number])
	) {
		whereConditions.push(
			eq(
				tables.auditLog.action,
				query.action as (typeof auditLogActions)[number],
			),
		);
	}
	if (
		query.resourceType &&
		auditLogResourceTypes.includes(
			query.resourceType as (typeof auditLogResourceTypes)[number],
		)
	) {
		whereConditions.push(
			eq(
				tables.auditLog.resourceType,
				query.resourceType as (typeof auditLogResourceTypes)[number],
			),
		);
	}

	const whereClause = and(...whereConditions);

	const [countResult] = await db
		.select({
			count: sql<number>`COUNT(*)`.as("count"),
		})
		.from(tables.auditLog)
		.where(whereClause);

	const total = Number(countResult?.count ?? 0);

	const logs = await db
		.select({
			id: tables.auditLog.id,
			createdAt: tables.auditLog.createdAt,
			userId: tables.auditLog.userId,
			action: tables.auditLog.action,
			resourceType: tables.auditLog.resourceType,
			resourceId: tables.auditLog.resourceId,
			metadata: tables.auditLog.metadata,
			userName: tables.user.name,
			userEmail: tables.user.email,
		})
		.from(tables.auditLog)
		.leftJoin(tables.user, eq(tables.auditLog.userId, tables.user.id))
		.where(whereClause)
		// Same-transaction writes share a createdAt, so break ties on id to keep
		// offset pagination stable.
		.orderBy(desc(tables.auditLog.createdAt), desc(tables.auditLog.id))
		.limit(limit)
		.offset(offset);

	return c.json({
		auditLogs: logs.map((log) => ({
			id: log.id,
			createdAt: log.createdAt.toISOString(),
			userId: log.userId,
			action: log.action,
			resourceType: log.resourceType,
			resourceId: log.resourceId,
			metadata: log.metadata,
			user: log.userEmail
				? {
						id: log.userId,
						email: log.userEmail,
						name: log.userName,
					}
				: null,
		})),
		total,
		limit,
		offset,
		filters: {
			actions: [...auditLogActions],
			resourceTypes: [...auditLogResourceTypes],
		},
	});
});

// ==================== Organization Settings ====================

const compliancePolicySchema = z.object({
	enabled: z.boolean(),
	requireSoc2: z.boolean().optional(),
	requireSoc2Type2: z.boolean().optional(),
	requireIso27001: z.boolean().optional(),
	requireSoc2OrIso27001: z.boolean().optional(),
	requireGdpr: z.boolean().optional(),
	blockApiTraining: z.boolean().optional(),
	blockPromptLogging: z.boolean().optional(),
	zeroDataRetention: z.boolean().optional(),
	blockStealthProviders: z.boolean().optional(),
	allowedCountries: z.array(z.string()).optional(),
	blockedProviders: z.array(z.string()).optional(),
	allowedProviders: z.array(z.string()).optional(),
	blockedModels: z.array(z.string()).optional(),
	allowedModels: z.array(z.string()).optional(),
});

const complianceAttestationSchema = z.object({
	soc2: z.union([z.literal(1), z.literal(2)]).nullish(),
	iso27001: z.boolean().nullish(),
	gdpr: z.boolean().nullish(),
	apiTraining: z.boolean().nullish(),
	promptLogging: z.boolean().nullish(),
	retentionPeriod: z.string().nullish(),
	headquarters: z.string().nullish(),
	attestedAt: z.string().optional(),
	attestedByUserId: z.string().optional(),
});

const getOrganizationSettings = createRoute({
	method: "get",
	path: "/organizations/{orgId}/settings",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						organization: z.object({
							id: z.string(),
							name: z.string(),
							safetyIdentifier: z.string(),
							billingEmail: z.string(),
							createdAt: z.string(),
							plan: z.string(),
							planExpiresAt: z.string().nullable(),
							planStartedAt: z.string().nullable(),
							kind: z.string(),
							devPlan: z.string(),
							status: z.string().nullable(),
							retentionLevel: z.string(),
							ssoAutoJoinDomain: z.string().nullable(),
							seats: z.number().nullable(),
							apiKeyLimit: z.number().nullable(),
							projectLimit: z.number().nullable(),
							subscriptionCancelled: z.boolean(),
							isTrialActive: z.boolean(),
							trialStartDate: z.string().nullable(),
							trialEndDate: z.string().nullable(),
							referralBonusEnabled: z.boolean(),
							autoTopUpEnabled: z.boolean(),
							providerCompliancePolicy: compliancePolicySchema.nullable(),
							billingCompany: z.string().nullable(),
							billingAddress: z.string().nullable(),
							billingTaxId: z.string().nullable(),
							billingNotes: z.string().nullable(),
							stripeCustomerId: z.string().nullable(),
							stripeSubscriptionId: z.string().nullable(),
							credits: z.string(),
							autoTopUpThreshold: z.string().nullable(),
							autoTopUpAmount: z.string().nullable(),
							lastTopUpAmount: z.string().nullable(),
							paymentFailureCount: z.number(),
							lastPaymentFailureAt: z.string().nullable(),
							paymentFailureStartedAt: z.string().nullable(),
						}),
						customProviders: z.array(
							z.object({
								id: z.string(),
								name: z.string().nullable(),
								status: z.string().nullable(),
								customModelsOnly: z.boolean(),
								complianceAttestation: complianceAttestationSchema.nullable(),
								createdAt: z.string(),
							}),
						),
					}),
				},
			},
			description:
				"Organization policy and settings overview, including the provider compliance policy and custom provider attestations.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

adminOrgDetails.openapi(getOrganizationSettings, async (c) => {
	const { orgId } = c.req.valid("param");

	const org = await requireOrganization(orgId);

	const customProviders = await db.query.providerKey.findMany({
		where: {
			organizationId: { eq: orgId },
			provider: { eq: "custom" },
			status: { ne: "deleted" },
		},
	});

	return c.json({
		organization: {
			id: org.id,
			name: org.name,
			safetyIdentifier: org.safetyIdentifier,
			billingEmail: org.billingEmail,
			createdAt: org.createdAt.toISOString(),
			plan: org.plan,
			planExpiresAt: org.planExpiresAt?.toISOString() ?? null,
			planStartedAt: org.planStartedAt?.toISOString() ?? null,
			kind: org.kind,
			devPlan: org.devPlan,
			status: org.status,
			retentionLevel: org.retentionLevel,
			ssoAutoJoinDomain: org.ssoAutoJoinDomain,
			seats: org.seats,
			apiKeyLimit: org.apiKeyLimit,
			projectLimit: org.projectLimit,
			subscriptionCancelled: org.subscriptionCancelled,
			isTrialActive: org.isTrialActive,
			trialStartDate: org.trialStartDate?.toISOString() ?? null,
			trialEndDate: org.trialEndDate?.toISOString() ?? null,
			referralBonusEnabled: org.referralBonusEnabled,
			autoTopUpEnabled: org.autoTopUpEnabled,
			providerCompliancePolicy: org.providerCompliancePolicy ?? null,
			billingCompany: org.billingCompany,
			billingAddress: org.billingAddress,
			billingTaxId: org.billingTaxId,
			billingNotes: org.billingNotes,
			stripeCustomerId: org.stripeCustomerId,
			stripeSubscriptionId: org.stripeSubscriptionId,
			credits: String(org.credits),
			autoTopUpThreshold: org.autoTopUpThreshold,
			autoTopUpAmount: org.autoTopUpAmount,
			lastTopUpAmount: org.lastTopUpAmount,
			paymentFailureCount: org.paymentFailureCount,
			lastPaymentFailureAt: org.lastPaymentFailureAt?.toISOString() ?? null,
			paymentFailureStartedAt:
				org.paymentFailureStartedAt?.toISOString() ?? null,
		},
		customProviders: customProviders.map((key) => ({
			id: key.id,
			name: key.name,
			status: key.status,
			customModelsOnly: key.customModelsOnly,
			complianceAttestation: key.complianceAttestation ?? null,
			createdAt: key.createdAt.toISOString(),
		})),
	});
});

// ==================== Payment Methods ====================

const adminPaymentMethodSchema = z.object({
	id: z.string(),
	type: z.string(),
	createdAt: z.string(),
	isDefault: z.boolean(),
	canReleaseDevPlanCardFingerprint: z.boolean(),
	card: z
		.object({
			brand: z.string(),
			last4: z.string(),
			expiryMonth: z.number(),
			expiryYear: z.number(),
		})
		.nullable(),
});

const adminDevPlanCardFingerprintSchema = z.object({
	id: z.string(),
	createdAt: z.string(),
	fingerprint: z.string(),
	isCurrent: z.boolean(),
	canRelease: z.boolean(),
});

type PaymentMethodOrganization = Pick<
	typeof tables.organization.$inferSelect,
	| "id"
	| "stripeCustomerId"
	| "stripeSubscriptionId"
	| "devPlanStripeSubscriptionId"
	| "devPlanCardFingerprint"
	| "chatPlanStripeSubscriptionId"
>;

interface OrganizationSubscription {
	id: string;
	kind: "default" | "devPlan" | "chatPlan";
	subscription: Stripe.Subscription | null;
}

function getStripeId(
	value: string | { id: string } | null | undefined,
): string | null {
	return typeof value === "string" ? value : (value?.id ?? null);
}

function isStripeMissingResourceError(
	error: unknown,
): error is Stripe.errors.StripeInvalidRequestError {
	return (
		error instanceof Stripe.errors.StripeInvalidRequestError &&
		(error.code === "resource_missing" || error.statusCode === 404)
	);
}

async function listCustomerPaymentMethods(
	stripe: Stripe,
	stripeCustomerId: string,
) {
	const paymentMethods: Stripe.PaymentMethod[] = [];
	let startingAfter: string | undefined;

	while (true) {
		const page = await stripe.paymentMethods.list({
			customer: stripeCustomerId,
			limit: 100,
			...(startingAfter ? { starting_after: startingAfter } : {}),
		});
		paymentMethods.push(...page.data);

		if (!page.has_more || page.data.length === 0) {
			return paymentMethods;
		}
		startingAfter = page.data[page.data.length - 1]?.id;
	}
}

async function retrieveOrganizationSubscription(
	stripe: Stripe,
	id: string,
	kind: OrganizationSubscription["kind"],
): Promise<OrganizationSubscription> {
	try {
		return {
			id,
			kind,
			subscription: await stripe.subscriptions.retrieve(id),
		};
	} catch (error) {
		if (isStripeMissingResourceError(error)) {
			return { id, kind, subscription: null };
		}
		throw error;
	}
}

async function getOrganizationPaymentMethodState(
	org: PaymentMethodOrganization,
) {
	if (!org.stripeCustomerId) {
		return null;
	}

	const stripe = getStripe();
	const subscriptionRequests: Promise<OrganizationSubscription>[] = [];
	if (org.stripeSubscriptionId) {
		subscriptionRequests.push(
			retrieveOrganizationSubscription(
				stripe,
				org.stripeSubscriptionId,
				"default",
			),
		);
	}
	if (org.devPlanStripeSubscriptionId) {
		subscriptionRequests.push(
			retrieveOrganizationSubscription(
				stripe,
				org.devPlanStripeSubscriptionId,
				"devPlan",
			),
		);
	}
	if (org.chatPlanStripeSubscriptionId) {
		subscriptionRequests.push(
			retrieveOrganizationSubscription(
				stripe,
				org.chatPlanStripeSubscriptionId,
				"chatPlan",
			),
		);
	}

	const [paymentMethods, customer, localPaymentMethods, subscriptions] =
		await Promise.all([
			listCustomerPaymentMethods(stripe, org.stripeCustomerId),
			stripe.customers.retrieve(org.stripeCustomerId),
			db.query.paymentMethod.findMany({
				where: { organizationId: org.id },
			}),
			Promise.all(subscriptionRequests),
		]);

	if (customer.deleted) {
		throw new HTTPException(404, { message: "Stripe customer not found" });
	}

	const defaultPaymentMethodIds = new Set<string>();
	const customerDefaultId = getStripeId(
		customer.invoice_settings?.default_payment_method,
	);
	if (customerDefaultId) {
		defaultPaymentMethodIds.add(customerDefaultId);
	}
	for (const { subscription } of subscriptions) {
		if (!subscription) {
			continue;
		}
		const subscriptionDefaultId = getStripeId(
			subscription.default_payment_method,
		);
		if (subscriptionDefaultId) {
			defaultPaymentMethodIds.add(subscriptionDefaultId);
		}
	}
	for (const paymentMethod of localPaymentMethods) {
		if (paymentMethod.isDefault) {
			defaultPaymentMethodIds.add(paymentMethod.stripePaymentMethodId);
		}
	}

	return {
		paymentMethods,
		customerDefaultId,
		localPaymentMethods,
		subscriptions,
		defaultPaymentMethodIds,
	};
}

const getOrganizationPaymentMethods = createRoute({
	method: "get",
	path: "/organizations/{orgId}/payment-methods",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						paymentMethods: z.array(adminPaymentMethodSchema),
						devPlanCardFingerprints: z.array(adminDevPlanCardFingerprintSchema),
					}),
				},
			},
			description: "Payment methods attached to the Stripe customer.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

adminOrgDetails.openapi(getOrganizationPaymentMethods, async (c) => {
	const { orgId } = c.req.valid("param");
	const org = await requireOrganization(orgId);
	const fingerprints = await db.query.devPlanCardFingerprintHistory.findMany({
		where: { organizationId: { eq: orgId } },
		orderBy: { createdAt: "desc" },
	});
	const devPlanCardFingerprints = fingerprints.map((entry) => ({
		id: entry.id,
		createdAt: entry.createdAt.toISOString(),
		fingerprint: entry.fingerprint,
		isCurrent: entry.fingerprint === org.devPlanCardFingerprint,
		canRelease: !org.devPlanStripeSubscriptionId,
	}));

	if (!org.stripeCustomerId) {
		return c.json({ paymentMethods: [], devPlanCardFingerprints });
	}

	const state = await getOrganizationPaymentMethodState(org);
	if (!state) {
		return c.json({ paymentMethods: [], devPlanCardFingerprints });
	}

	return c.json({
		paymentMethods: state.paymentMethods.map((paymentMethod) => ({
			id: paymentMethod.id,
			type: paymentMethod.type,
			createdAt: new Date(paymentMethod.created * 1000).toISOString(),
			isDefault: state.defaultPaymentMethodIds.has(paymentMethod.id),
			canReleaseDevPlanCardFingerprint: Boolean(
				!org.devPlanStripeSubscriptionId &&
				paymentMethod.card?.fingerprint &&
				paymentMethod.card.fingerprint === org.devPlanCardFingerprint,
			),
			card: paymentMethod.card
				? {
						brand: paymentMethod.card.brand,
						last4: paymentMethod.card.last4,
						expiryMonth: paymentMethod.card.exp_month,
						expiryYear: paymentMethod.card.exp_year,
					}
				: null,
		})),
		devPlanCardFingerprints,
	});
});

const releaseDevPlanCardFingerprint = createRoute({
	method: "delete",
	path: "/organizations/{orgId}/dev-plan-card-fingerprints/{fingerprintId}",
	request: {
		params: z.object({
			orgId: z.string(),
			fingerprintId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ success: z.boolean() }),
				},
			},
			description: "DevPass card fingerprint released.",
		},
		404: { description: "Organization or fingerprint not found." },
		409: { description: "An active DevPass subscription still uses the card." },
	},
});

adminOrgDetails.openapi(releaseDevPlanCardFingerprint, async (c) => {
	const { orgId, fingerprintId } = c.req.valid("param");
	const org = await requireOrganization(orgId);
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(404, { message: "Fingerprint not found" });
	}
	if (org.devPlanStripeSubscriptionId) {
		throw new HTTPException(409, {
			message:
				"End the DevPass subscription before releasing its card fingerprint.",
		});
	}

	const fingerprint = await db.query.devPlanCardFingerprintHistory.findFirst({
		where: {
			id: { eq: fingerprintId },
			organizationId: { eq: orgId },
		},
	});
	if (!fingerprint) {
		throw new HTTPException(404, { message: "Fingerprint not found" });
	}

	await db.transaction(async (tx) => {
		await tx
			.delete(tables.devPlanCardFingerprintHistory)
			.where(eq(tables.devPlanCardFingerprintHistory.id, fingerprintId));
		if (org.devPlanCardFingerprint === fingerprint.fingerprint) {
			await tx
				.update(tables.organization)
				.set({ devPlanCardFingerprint: null })
				.where(eq(tables.organization.id, orgId));
		}
	});

	await logAuditEvent({
		organizationId: orgId,
		userId: user.id,
		action: "dev_plan.release_card_fingerprint",
		resourceType: "dev_plan",
		resourceId: fingerprintId,
	});

	return c.json({ success: true });
});

const deleteOrganizationPaymentMethod = createRoute({
	method: "delete",
	path: "/organizations/{orgId}/payment-methods/{paymentMethodId}",
	request: {
		params: z.object({
			orgId: z.string(),
			paymentMethodId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						replacementPaymentMethodId: z.string().optional(),
						releaseDevPlanCardFingerprint: z.boolean().optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ success: z.boolean() }),
				},
			},
			description: "Payment method detached from Stripe and removed locally.",
		},
		404: {
			description: "Organization or payment method not found.",
		},
		400: {
			description: "A valid replacement is required for a default method.",
		},
		409: {
			description: "The replacement card is already used elsewhere.",
		},
	},
});

adminOrgDetails.openapi(deleteOrganizationPaymentMethod, async (c) => {
	const { orgId, paymentMethodId } = c.req.valid("param");
	const { replacementPaymentMethodId, releaseDevPlanCardFingerprint } =
		c.req.valid("json");
	const org = await requireOrganization(orgId);
	const user = c.get("user");

	if (!org.stripeCustomerId || !user) {
		throw new HTTPException(404, { message: "Payment method not found" });
	}

	const stripe = getStripe();
	const localPaymentMethod = await db.query.paymentMethod.findFirst({
		where: {
			organizationId: { eq: orgId },
			stripePaymentMethodId: { eq: paymentMethodId },
		},
	});
	let paymentMethod: Stripe.PaymentMethod | null = null;
	try {
		paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
	} catch (error) {
		if (!isStripeMissingResourceError(error)) {
			throw error;
		}
		if (!localPaymentMethod) {
			throw new HTTPException(404, {
				message: "Payment method not found",
			});
		}
	}

	const stripeCustomerId = paymentMethod
		? getStripeId(paymentMethod.customer)
		: null;
	const attachedToOrganization = stripeCustomerId === org.stripeCustomerId;
	const hasDetachedLocalMethod =
		stripeCustomerId === null && Boolean(localPaymentMethod);
	if (!attachedToOrganization && !hasDetachedLocalMethod) {
		throw new HTTPException(404, { message: "Payment method not found" });
	}

	const paymentMethodFingerprint = paymentMethod?.card?.fingerprint ?? null;
	const canReleaseDevPlanCardFingerprint = Boolean(
		!org.devPlanStripeSubscriptionId &&
		paymentMethodFingerprint &&
		paymentMethodFingerprint === org.devPlanCardFingerprint,
	);
	if (releaseDevPlanCardFingerprint && !canReleaseDevPlanCardFingerprint) {
		throw new HTTPException(400, {
			message:
				"This payment method cannot release the retained DevPass card fingerprint.",
		});
	}

	const state = await getOrganizationPaymentMethodState(org);
	if (!state) {
		throw new HTTPException(404, { message: "Payment method not found" });
	}

	const remainingPaymentMethods = state.paymentMethods.filter(
		(candidate) => candidate.id !== paymentMethodId,
	);
	const isDefault = state.defaultPaymentMethodIds.has(paymentMethodId);
	const replacementPaymentMethod = replacementPaymentMethodId
		? remainingPaymentMethods.find(
				(candidate) => candidate.id === replacementPaymentMethodId,
			)
		: undefined;

	if (isDefault && remainingPaymentMethods.length > 0) {
		if (!replacementPaymentMethod) {
			throw new HTTPException(400, {
				message:
					"Select another attached payment method before deleting the default method.",
			});
		}
	} else if (replacementPaymentMethodId && !replacementPaymentMethod) {
		throw new HTTPException(400, {
			message: "Replacement payment method is not attached to this customer.",
		});
	}

	const replacementId = replacementPaymentMethod?.id ?? null;
	const clearAllDefaults = remainingPaymentMethods.length === 0;
	const shouldUpdateCustomerDefault =
		clearAllDefaults || state.customerDefaultId === paymentMethodId;
	const subscriptionsToUpdate = state.subscriptions.filter(
		(
			entry,
		): entry is OrganizationSubscription & {
			subscription: Stripe.Subscription;
		} => {
			if (!entry.subscription) {
				return false;
			}
			return (
				clearAllDefaults ||
				getStripeId(entry.subscription.default_payment_method) ===
					paymentMethodId
			);
		},
	);
	const subscriptionInheritsChangedCustomerDefault = (
		kind: OrganizationSubscription["kind"],
	) =>
		shouldUpdateCustomerDefault &&
		state.subscriptions.some(
			(entry) =>
				entry.kind === kind &&
				entry.subscription &&
				!getStripeId(entry.subscription.default_payment_method),
		);
	const subscriptionUsesRetryReplacement = (
		kind: OrganizationSubscription["kind"],
	) =>
		hasDetachedLocalMethod &&
		Boolean(replacementId) &&
		state.subscriptions.some(
			(entry) =>
				entry.kind === kind &&
				entry.subscription &&
				getStripeId(entry.subscription.default_payment_method) ===
					replacementId,
		);
	const updateDevPlanFingerprint = clearAllDefaults
		? Boolean(org.devPlanStripeSubscriptionId)
		: subscriptionsToUpdate.some((entry) => entry.kind === "devPlan") ||
			subscriptionInheritsChangedCustomerDefault("devPlan") ||
			subscriptionUsesRetryReplacement("devPlan");
	const updateChatPlanFingerprint = clearAllDefaults
		? Boolean(org.chatPlanStripeSubscriptionId)
		: subscriptionsToUpdate.some((entry) => entry.kind === "chatPlan") ||
			subscriptionInheritsChangedCustomerDefault("chatPlan") ||
			subscriptionUsesRetryReplacement("chatPlan");
	const replacementFingerprint =
		replacementPaymentMethod?.card?.fingerprint ?? null;

	if (
		replacementId &&
		(updateDevPlanFingerprint || updateChatPlanFingerprint) &&
		!replacementFingerprint
	) {
		throw new HTTPException(400, {
			message: "DevPass and Chat subscriptions require a replacement card.",
		});
	}

	if (replacementFingerprint && updateDevPlanFingerprint) {
		const conflictingOrganization = await findDevPlanCardFingerprintOwner(
			replacementFingerprint,
			orgId,
		);
		if (conflictingOrganization) {
			throw new HTTPException(409, {
				message: "Replacement card is already used by another organization.",
			});
		}
	}
	if (replacementFingerprint && updateChatPlanFingerprint) {
		const conflictingOrganization = await db.query.organization.findFirst({
			where: {
				chatPlanCardFingerprint: { eq: replacementFingerprint },
				id: { ne: orgId },
			},
		});
		if (conflictingOrganization) {
			throw new HTTPException(409, {
				message: "Replacement card is already used by another organization.",
			});
		}
	}

	if (shouldUpdateCustomerDefault) {
		await stripe.customers.update(org.stripeCustomerId, {
			invoice_settings: {
				default_payment_method: replacementId ?? "",
			},
		});
	}
	for (const { id } of subscriptionsToUpdate) {
		await stripe.subscriptions.update(id, {
			default_payment_method: replacementId ?? "",
		});
	}

	if (attachedToOrganization) {
		await stripe.paymentMethods.detach(paymentMethodId);
	}

	const localReplacement = replacementId
		? state.localPaymentMethods.find(
				(candidate) => candidate.stripePaymentMethodId === replacementId,
			)
		: undefined;
	const disableAutoTopUp = clearAllDefaults;
	const shouldReconcileLocalDefault =
		clearAllDefaults ||
		shouldUpdateCustomerDefault ||
		Boolean(localPaymentMethod?.isDefault) ||
		(hasDetachedLocalMethod &&
			Boolean(replacementId) &&
			state.customerDefaultId === replacementId);

	await db.transaction(async (tx) => {
		if (releaseDevPlanCardFingerprint && paymentMethodFingerprint) {
			await tx
				.delete(tables.devPlanCardFingerprintHistory)
				.where(
					and(
						eq(tables.devPlanCardFingerprintHistory.organizationId, orgId),
						eq(
							tables.devPlanCardFingerprintHistory.fingerprint,
							paymentMethodFingerprint,
						),
					),
				);
		}

		if (updateDevPlanFingerprint && replacementFingerprint) {
			await tx
				.insert(tables.devPlanCardFingerprintHistory)
				.values({
					organizationId: orgId,
					fingerprint: replacementFingerprint,
				})
				.onConflictDoNothing();
		}

		if (shouldReconcileLocalDefault) {
			await tx
				.update(tables.paymentMethod)
				.set({ isDefault: false })
				.where(eq(tables.paymentMethod.organizationId, orgId));

			if (localReplacement) {
				await tx
					.update(tables.paymentMethod)
					.set({ isDefault: true })
					.where(eq(tables.paymentMethod.id, localReplacement.id));
			} else if (replacementPaymentMethod) {
				await tx.insert(tables.paymentMethod).values({
					organizationId: orgId,
					stripePaymentMethodId: replacementPaymentMethod.id,
					type: replacementPaymentMethod.type,
					isDefault: true,
				});
			}
		}

		if (
			disableAutoTopUp ||
			updateDevPlanFingerprint ||
			updateChatPlanFingerprint ||
			releaseDevPlanCardFingerprint
		) {
			await tx
				.update(tables.organization)
				.set({
					...(disableAutoTopUp ? { autoTopUpEnabled: false } : {}),
					...(releaseDevPlanCardFingerprint
						? { devPlanCardFingerprint: null }
						: updateDevPlanFingerprint
							? { devPlanCardFingerprint: replacementFingerprint }
							: {}),
					...(updateChatPlanFingerprint
						? { chatPlanCardFingerprint: replacementFingerprint }
						: {}),
				})
				.where(eq(tables.organization.id, orgId));
		}

		await tx
			.delete(tables.paymentMethod)
			.where(
				and(
					eq(tables.paymentMethod.organizationId, orgId),
					eq(tables.paymentMethod.stripePaymentMethodId, paymentMethodId),
				),
			);
	});

	await logAuditEvent({
		organizationId: orgId,
		userId: user.id,
		action: "payment.method.delete",
		resourceType: "payment_method",
		resourceId: paymentMethodId,
		metadata: {
			cardLast4: paymentMethod?.card?.last4,
			replacementPaymentMethodId: replacementId,
			autoTopUpDisabled: disableAutoTopUp && org.autoTopUpEnabled,
			devPlanCardFingerprintReleased: releaseDevPlanCardFingerprint === true,
		},
	});

	return c.json({ success: true });
});

// ==================== Guardrails ====================

const guardrailSystemRuleSchema = z.object({
	enabled: z.boolean(),
	action: z.enum(["block", "redact", "warn", "allow"]),
});

const guardrailSystemRulesSchema = z.object({
	prompt_injection: guardrailSystemRuleSchema,
	jailbreak: guardrailSystemRuleSchema,
	pii_detection: guardrailSystemRuleSchema,
	secrets: guardrailSystemRuleSchema,
	file_types: guardrailSystemRuleSchema,
	document_leakage: guardrailSystemRuleSchema,
});

const guardrailCustomRuleConfigSchema = z.union([
	z.object({
		type: z.literal("blocked_terms"),
		terms: z.array(z.string()),
		matchType: z.enum(["exact", "contains", "regex"]),
		caseSensitive: z.boolean(),
	}),
	z.object({
		type: z.literal("custom_regex"),
		pattern: z.string(),
	}),
	z.object({
		type: z.literal("topic_restriction"),
		blockedTopics: z.array(z.string()),
		allowedTopics: z.array(z.string()).optional(),
	}),
]);

const getOrganizationGuardrails = createRoute({
	method: "get",
	path: "/organizations/{orgId}/guardrails",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						config: z
							.object({
								id: z.string(),
								enabled: z.boolean(),
								systemRules: guardrailSystemRulesSchema.nullable(),
								maxFileSizeMb: z.number(),
								allowedFileTypes: z.array(z.string()),
								piiAction: z.string().nullable(),
								createdAt: z.string(),
								updatedAt: z.string(),
							})
							.nullable(),
						rules: z.array(
							z.object({
								id: z.string(),
								name: z.string(),
								type: z.string(),
								config: guardrailCustomRuleConfigSchema,
								priority: z.number(),
								enabled: z.boolean(),
								action: z.string(),
								createdAt: z.string(),
								updatedAt: z.string(),
							}),
						),
						violations: z.object({
							total: z.number(),
							last30Days: z.number(),
							recent: z.array(
								z.object({
									id: z.string(),
									createdAt: z.string(),
									ruleName: z.string(),
									category: z.string(),
									actionTaken: z.string(),
									model: z.string().nullable(),
								}),
							),
						}),
					}),
				},
			},
			description: "Guardrail configuration, custom rules and violations.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

adminOrgDetails.openapi(getOrganizationGuardrails, async (c) => {
	const { orgId } = c.req.valid("param");

	await requireOrganization(orgId);

	const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
	const thirtyDaysAgo = new Date(Date.now() - thirtyDaysMs);

	const [config, rules, [totalResult], [recentResult], recentViolations] =
		await Promise.all([
			db.query.guardrailConfig.findFirst({
				where: {
					organizationId: { eq: orgId },
					projectId: { isNull: true },
				},
			}),
			// Org-level rules only, to match the org-level config above — project
			// overrides are configured and enforced separately.
			db.query.guardrailRule.findMany({
				where: {
					organizationId: { eq: orgId },
					projectId: { isNull: true },
				},
				orderBy: {
					priority: "asc",
				},
			}),
			db
				.select({
					count: sql<number>`COUNT(*)`.as("count"),
				})
				.from(tables.guardrailViolation)
				.where(eq(tables.guardrailViolation.organizationId, orgId)),
			db
				.select({
					count: sql<number>`COUNT(*)`.as("count"),
				})
				.from(tables.guardrailViolation)
				.where(
					and(
						eq(tables.guardrailViolation.organizationId, orgId),
						gte(tables.guardrailViolation.createdAt, thirtyDaysAgo),
					),
				),
			db.query.guardrailViolation.findMany({
				where: {
					organizationId: { eq: orgId },
				},
				orderBy: {
					createdAt: "desc",
				},
				limit: 10,
			}),
		]);

	return c.json({
		config: config
			? {
					id: config.id,
					enabled: config.enabled,
					systemRules: config.systemRules ?? null,
					maxFileSizeMb: config.maxFileSizeMb,
					allowedFileTypes: config.allowedFileTypes,
					piiAction: config.piiAction,
					createdAt: config.createdAt.toISOString(),
					updatedAt: config.updatedAt.toISOString(),
				}
			: null,
		rules: rules.map((rule) => ({
			id: rule.id,
			name: rule.name,
			type: rule.type,
			config: rule.config,
			priority: rule.priority,
			enabled: rule.enabled,
			action: rule.action,
			createdAt: rule.createdAt.toISOString(),
			updatedAt: rule.updatedAt.toISOString(),
		})),
		violations: {
			total: Number(totalResult?.count ?? 0),
			last30Days: Number(recentResult?.count ?? 0),
			recent: recentViolations.map((violation) => ({
				id: violation.id,
				createdAt: violation.createdAt.toISOString(),
				ruleName: violation.ruleName,
				category: violation.category,
				actionTaken: violation.actionTaken,
				model: violation.model,
			})),
		},
	});
});

// ==================== SSO / SCIM ====================

const getOrganizationSso = createRoute({
	method: "get",
	path: "/organizations/{orgId}/sso",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						ssoAutoJoinDomain: z.string().nullable(),
						connections: z.array(
							z.object({
								id: z.string(),
								issuer: z.string(),
								domain: z.string(),
								providerId: z.string(),
								providerType: z.string(),
								protocol: z.enum(["saml", "oidc", "unknown"]),
								enforced: z.boolean(),
								domainVerified: z.boolean(),
								createdAt: z.string(),
								updatedAt: z.string(),
							}),
						),
						scimTokens: z.array(
							z.object({
								id: z.string(),
								maskedToken: z.string(),
								ssoProviderId: z.string().nullable(),
								status: z.string(),
								lastUsedAt: z.string().nullable(),
								createdAt: z.string(),
							}),
						),
						roleMappings: z.array(
							z.object({
								id: z.string(),
								groupName: z.string(),
								role: z.string(),
								createdAt: z.string(),
							}),
						),
						defaultProjects: z.array(
							z.object({
								id: z.string(),
								projectId: z.string(),
								projectName: z.string().nullable(),
							}),
						),
						scimGroups: z.array(
							z.object({
								id: z.string(),
								displayName: z.string(),
								externalId: z.string().nullable(),
								memberCount: z.number(),
								createdAt: z.string(),
							}),
						),
					}),
				},
			},
			description: "SSO connections, SCIM provisioning and related settings.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

adminOrgDetails.openapi(getOrganizationSso, async (c) => {
	const { orgId } = c.req.valid("param");

	const org = await requireOrganization(orgId);

	const [connections, scimTokens, roleMappings, defaultProjects, scimGroups] =
		await Promise.all([
			db.query.ssoProvider.findMany({
				where: {
					organizationId: { eq: orgId },
				},
				orderBy: {
					createdAt: "desc",
				},
			}),
			db.query.scimToken.findMany({
				where: {
					organizationId: { eq: orgId },
					status: { ne: "deleted" },
				},
				orderBy: {
					createdAt: "desc",
				},
			}),
			db.query.ssoRoleMapping.findMany({
				where: {
					organizationId: { eq: orgId },
				},
				orderBy: {
					groupName: "asc",
				},
			}),
			db
				.select({
					id: tables.ssoDefaultProject.id,
					projectId: tables.ssoDefaultProject.projectId,
					projectName: tables.project.name,
				})
				.from(tables.ssoDefaultProject)
				.leftJoin(
					tables.project,
					eq(tables.ssoDefaultProject.projectId, tables.project.id),
				)
				.where(eq(tables.ssoDefaultProject.organizationId, orgId)),
			db
				.select({
					id: tables.scimGroup.id,
					displayName: tables.scimGroup.displayName,
					externalId: tables.scimGroup.externalId,
					createdAt: tables.scimGroup.createdAt,
					memberCount: sql<number>`COUNT(${tables.scimGroupMember.id})`.as(
						"member_count",
					),
				})
				.from(tables.scimGroup)
				.leftJoin(
					tables.scimGroupMember,
					eq(tables.scimGroup.id, tables.scimGroupMember.scimGroupId),
				)
				.where(eq(tables.scimGroup.organizationId, orgId))
				.groupBy(tables.scimGroup.id)
				.orderBy(tables.scimGroup.displayName),
		]);

	return c.json({
		ssoAutoJoinDomain: org.ssoAutoJoinDomain,
		// The raw oidcConfig/samlConfig columns carry IdP secrets (client
		// secrets, certificates) and are deliberately not exposed; only which
		// protocol is configured is reported.
		connections: connections.map((connection) => ({
			id: connection.id,
			issuer: connection.issuer,
			domain: connection.domain,
			providerId: connection.providerId,
			providerType: connection.providerType,
			protocol: connection.samlConfig
				? ("saml" as const)
				: connection.oidcConfig
					? ("oidc" as const)
					: ("unknown" as const),
			enforced: connection.enforced,
			domainVerified: connection.domainVerified,
			createdAt: connection.createdAt.toISOString(),
			updatedAt: connection.updatedAt.toISOString(),
		})),
		scimTokens: scimTokens.map((token) => ({
			id: token.id,
			maskedToken: token.maskedToken,
			ssoProviderId: token.ssoProviderId,
			status: token.status,
			lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
			createdAt: token.createdAt.toISOString(),
		})),
		roleMappings: roleMappings.map((mapping) => ({
			id: mapping.id,
			groupName: mapping.groupName,
			role: mapping.role,
			createdAt: mapping.createdAt.toISOString(),
		})),
		defaultProjects,
		scimGroups: scimGroups.map((group) => ({
			id: group.id,
			displayName: group.displayName,
			externalId: group.externalId,
			memberCount: Number(group.memberCount ?? 0),
			createdAt: group.createdAt.toISOString(),
		})),
	});
});

// ==================== Provider margin share ====================

const updateProviderMarginShare = createRoute({
	method: "patch",
	path: "/organizations/{orgId}/margin-share",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						// Whole percent of the carrier margin passed to the org.
						percent: z.number().min(0).max(100),
					}),
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
						percent: z.number(),
					}),
				},
			},
			description: "Provider margin share updated.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

adminOrgDetails.openapi(updateProviderMarginShare, async (c) => {
	const user = c.get("user");
	const { orgId } = c.req.valid("param");
	const { percent } = c.req.valid("json");

	const org = await requireOrganization(orgId);
	if (org.status === "deleted") {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const sharePercent = new Decimal(percent).div(100).toString();

	await db
		.insert(tables.organizationProviderMarginShare)
		.values({ organizationId: orgId, sharePercent })
		.onConflictDoUpdate({
			target: tables.organizationProviderMarginShare.organizationId,
			set: { sharePercent, updatedAt: new Date() },
		});

	await logAuditEvent({
		organizationId: orgId,
		userId: user!.id,
		action: "provider_margin_share.update",
		resourceType: "organization",
		resourceId: orgId,
		metadata: { percent },
	});

	return c.json({
		message: "Provider margin share updated",
		percent,
	});
});
