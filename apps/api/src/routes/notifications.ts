import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { getApiKeyScope, getUserProjectIds } from "@/utils/authorization.js";
import { createRoute } from "@/utils/create-route.js";

import {
	and,
	db,
	eq,
	getSuppressedCategories,
	inArray,
	isNull,
	notification,
	notificationPreference,
	notificationModelScopes,
	notificationTypes,
	notInArray,
	or,
	sql,
	suppressEmailCategory,
	unsuppressEmailCategory,
} from "@llmgateway/db";
import {
	emailCategories,
	isNotificationCategory,
} from "@llmgateway/shared/email-unsubscribe";
import {
	isInAlertAudience,
	orgAlertAudience,
} from "@llmgateway/shared/organization-roles";
import {
	DEFAULT_PROVIDER_ISSUE_SETTINGS,
	PROVIDER_ISSUE_ERROR_RATE_PERCENTS,
	PROVIDER_ISSUE_USAGE_HOURS,
	PROVIDER_ISSUE_WINDOW_MINUTES,
} from "@llmgateway/shared/provider-issue-alerts";

import type { ServerTypes } from "@/vars.js";

export const notifications = new OpenAPIHono<ServerTypes>();

/** An integer from `values`, published as an OpenAPI enum. */
function oneOf(values: readonly number[]) {
	return z
		.number()
		.int()
		.refine((value) => values.includes(value), {
			message: `Must be one of ${values.join(", ")}`,
		})
		.openapi({ enum: [...values] });
}

/**
 * One row of the combined preferences screen. `inApp` and `budgetThreshold`
 * are null for the email-only categories, which have no notification feed
 * entry and no threshold.
 */
const preferenceSchema = z.object({
	category: z.enum(emailCategories),
	inApp: z.boolean().nullable(),
	email: z.boolean(),
	budgetThreshold: z.number().int().min(50).max(100).nullable(),
	/** Which models price change alerts cover; null for every other category. */
	modelScope: z.enum(notificationModelScopes).nullable().optional(),
	/** Models covered when `modelScope` is "selected". */
	modelIds: z.array(z.string().min(1).max(200)).max(500).nullable().optional(),
	/** Provider issue alerts: error-rate window; null for every other category. */
	issueWindowMinutes: oneOf(PROVIDER_ISSUE_WINDOW_MINUTES)
		.nullable()
		.optional(),
	/** Provider issue alerts: error rate that triggers an alert. */
	issueErrorRatePercent: oneOf(PROVIDER_ISSUE_ERROR_RATE_PERCENTS)
		.nullable()
		.optional(),
	/** Provider issue alerts: how recently a mapping must have been used. */
	issueUsageHours: oneOf(PROVIDER_ISSUE_USAGE_HOURS).nullable().optional(),
});
const notificationSchema = z.object({
	id: z.string(),
	type: z.enum(notificationTypes),
	title: z.string(),
	message: z.string(),
	href: z.string(),
	createdAt: z.string(),
	readAt: z.string().nullable(),
});

// Org-level alert types follow the org's delivery settings until a user opts out.
const orgAlertTypes = new Set<string>([
	"model_available",
	"compliance_downgrade",
	"org_limit",
	"data_stream",
]);

// Org alert types whose audience is always owners and admins.
const adminAlertTypes: (typeof notificationTypes)[number][] = [
	"org_limit",
	"data_stream",
];

/**
 * Orgs whose alerts of `type` the user may still read: a member whose role is
 * inside that alert type's audience.
 */
async function alertOrganizationIds(
	userId: string,
	type: string,
): Promise<string[]> {
	const memberships = await db.query.userOrganization.findMany({
		columns: { organizationId: true, role: true },
		where: { userId },
		with: { organization: { columns: { complianceAlertSettings: true } } },
	});
	return memberships
		.filter((m) => {
			const audience = orgAlertAudience(
				type,
				m.organization?.complianceAlertSettings?.recipientAudience,
			);
			return !!audience && isInAlertAudience(m.role, audience);
		})
		.map((m) => m.organizationId);
}

async function visibility(userId: string) {
	// Compliance alert types share one audience; admin alerts have their own.
	const [scope, complianceOrgIds, adminOrgIds] = await Promise.all([
		getUserProjectIds(userId).then((ids) => getApiKeyScope(userId, ids)),
		alertOrganizationIds(userId, "compliance_downgrade"),
		alertOrganizationIds(userId, "org_limit"),
	]);
	return and(
		eq(notification.userId, userId),
		eq(notification.inApp, true),
		or(
			inArray(notification.projectId, scope.privilegedProjectIds),
			and(
				inArray(notification.projectId, scope.restrictedProjectIds),
				inArray(notification.apiKeyId, scope.ownApiKeyIds),
			),
			and(
				inArray(notification.organizationId, complianceOrgIds),
				notInArray(notification.type, adminAlertTypes),
			),
			and(
				inArray(notification.organizationId, adminOrgIds),
				inArray(notification.type, adminAlertTypes),
			),
			// Price changes describe the public catalogue, not a project.
			and(
				eq(notification.type, "model_price_change"),
				isNull(notification.projectId),
				isNull(notification.organizationId),
			),
		),
	);
}

notifications.openapi(
	createRoute({
		method: "get",
		path: "/preferences",
		responses: {
			200: {
				description: "Your alert and email preferences",
				content: {
					"application/json": {
						schema: z.object({
							/** The address every email preference on this page applies to. */
							email: z.string(),
							preferences: z.array(preferenceSchema),
						}),
					},
				},
			},
		},
	}),
	async (c) => {
		const userId = c.get("user")!.id;
		const recipient = await db.query.user.findFirst({
			columns: { email: true, emailVerified: true },
			where: { id: userId },
		});
		if (!recipient) {
			throw new HTTPException(404, { message: "User not found" });
		}
		const [saved, suppressed] = await Promise.all([
			db.query.notificationPreference.findMany({ where: { userId } }),
			getSuppressedCategories(recipient.email),
		]);
		// Unverified addresses are never emailed, and reporting email as on would
		// make the PUT below reject the next in-app toggle.
		const emailDefault = recipient.emailVerified === true;
		return c.json({
			email: recipient.email,
			preferences: emailCategories.map((category) => {
				const isSuppressed = suppressed.includes(category);
				if (!isNotificationCategory(category)) {
					// Email-only: on unless the address is on the suppression list.
					return {
						category,
						inApp: null,
						email: !isSuppressed,
						budgetThreshold: null,
						modelScope: null,
						modelIds: null,
						issueWindowMinutes: null,
						issueErrorRatePercent: null,
						issueUsageHours: null,
					};
				}
				const row = saved.find((p) => p.type === category);
				const priceChange = category === "model_price_change";
				const issue = category === "provider_issue";
				const issueSettings = { ...DEFAULT_PROVIDER_ISSUE_SETTINGS, ...row };
				return {
					category,
					inApp: row?.inApp ?? orgAlertTypes.has(category),
					email:
						(row?.email ?? (orgAlertTypes.has(category) && emailDefault)) &&
						!isSuppressed,
					budgetThreshold:
						category === "budget" ? (row?.budgetThreshold ?? 80) : null,
					modelScope: priceChange ? (row?.modelScope ?? "used") : null,
					modelIds: priceChange ? (row?.modelIds ?? []) : null,
					issueWindowMinutes: issue ? issueSettings.issueWindowMinutes : null,
					issueErrorRatePercent: issue
						? issueSettings.issueErrorRatePercent
						: null,
					issueUsageHours: issue ? issueSettings.issueUsageHours : null,
				};
			}),
		});
	},
);

notifications.openapi(
	createRoute({
		method: "put",
		path: "/preferences",
		request: {
			body: { content: { "application/json": { schema: preferenceSchema } } },
		},
		responses: {
			200: {
				description: "Saved preference",
				content: { "application/json": { schema: preferenceSchema } },
			},
		},
	}),
	async (c) => {
		const userId = c.get("user")!.id;
		const value = c.req.valid("json");
		const recipient = await db.query.user.findFirst({
			columns: { email: true, emailVerified: true },
			where: { id: userId },
		});
		if (!recipient) {
			throw new HTTPException(404, { message: "User not found" });
		}
		if (value.email && !recipient.emailVerified) {
			throw new HTTPException(403, {
				message: "Verify your email before enabling email alerts",
			});
		}

		const modelScope =
			value.category === "model_price_change"
				? (value.modelScope ?? undefined)
				: undefined;
		// Omitted fields keep the saved value (or the column default).
		const issueSettings =
			value.category === "provider_issue"
				? {
						issueWindowMinutes: value.issueWindowMinutes ?? undefined,
						issueErrorRatePercent: value.issueErrorRatePercent ?? undefined,
						issueUsageHours: value.issueUsageHours ?? undefined,
					}
				: {};
		// Unknown ids are dropped rather than rejected: a saved model can be
		// removed from the catalogue later, and every save sends the list back.
		let modelIds: string[] | undefined;
		if (value.category === "model_price_change" && value.modelIds) {
			const requested = [...new Set(value.modelIds)];
			const known = new Set(
				requested.length
					? (
							await db.query.model.findMany({
								columns: { id: true },
								where: { id: { in: requested } },
							})
						).map((model) => model.id)
					: [],
			);
			modelIds = requested.filter((id) => known.has(id));
		}

		// Enabling always clears the suppression row; a preference that says yes
		// while the address is suppressed would silently never deliver.
		if (value.email) {
			await unsuppressEmailCategory(recipient.email, value.category);
		} else if (!isNotificationCategory(value.category)) {
			// Email-only categories have no preference row, so the suppression
			// list is where "off" is recorded.
			await suppressEmailCategory(recipient.email, value.category, "dashboard");
		}

		if (isNotificationCategory(value.category)) {
			await db
				.insert(notificationPreference)
				.values({
					userId,
					type: value.category,
					inApp: value.inApp ?? false,
					email: value.email,
					budgetThreshold: value.budgetThreshold ?? 80,
					modelScope,
					modelIds,
					...issueSettings,
				})
				.onConflictDoUpdate({
					target: [notificationPreference.userId, notificationPreference.type],
					set: {
						inApp: value.inApp ?? false,
						email: value.email,
						budgetThreshold: value.budgetThreshold ?? 80,
						modelScope,
						modelIds,
						...issueSettings,
					},
				});
		}

		return c.json(modelIds ? { ...value, modelIds } : value);
	},
);

notifications.openapi(
	createRoute({
		method: "get",
		path: "/",
		responses: {
			200: {
				description: "Recent alerts",
				content: {
					"application/json": {
						schema: z.object({
							notifications: z.array(notificationSchema),
							unreadCount: z.number(),
						}),
					},
				},
			},
		},
	}),
	async (c) => {
		const filter = await visibility(c.get("user")!.id);
		const [items, [count]] = await Promise.all([
			db
				.select()
				.from(notification)
				.where(filter)
				.orderBy(sql`${notification.createdAt} DESC`)
				.limit(50),
			db
				.select({ value: sql<number>`count(*)::int` })
				.from(notification)
				.where(and(filter, isNull(notification.readAt))),
		]);
		return c.json({
			notifications: items.map((item) => ({
				id: item.id,
				type: item.type,
				title: item.title,
				message: item.message,
				href: item.href,
				createdAt: item.createdAt.toISOString(),
				readAt: item.readAt?.toISOString() ?? null,
			})),
			unreadCount: count.value,
		});
	},
);

notifications.openapi(
	createRoute({
		method: "post",
		path: "/read",
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.union([
							z.object({ ids: z.array(z.string()).min(1).max(50) }),
							z.object({ all: z.literal(true) }),
						]),
					},
				},
			},
		},
		responses: {
			200: {
				description: "Alerts marked read",
				content: {
					"application/json": { schema: z.object({ success: z.boolean() }) },
				},
			},
		},
	}),
	async (c) => {
		const body = c.req.valid("json");
		await db
			.update(notification)
			.set({ readAt: new Date() })
			.where(
				and(
					await visibility(c.get("user")!.id),
					"ids" in body ? inArray(notification.id, body.ids) : undefined,
					isNull(notification.readAt),
				),
			);
		return c.json({ success: true });
	},
);
