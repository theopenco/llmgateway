import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { getApiKeyScope, getUserProjectIds } from "@/utils/authorization.js";

import {
	and,
	db,
	eq,
	getSuppressedCategories,
	inArray,
	isNull,
	notification,
	notificationPreference,
	notificationTypes,
	or,
	sql,
	suppressEmailCategory,
	unsuppressEmailCategory,
} from "@llmgateway/db";
import {
	emailCategories,
	isNotificationCategory,
} from "@llmgateway/shared/email-unsubscribe";
import { isInAlertAudience } from "@llmgateway/shared/organization-roles";

import type { ServerTypes } from "@/vars.js";

export const notifications = new OpenAPIHono<ServerTypes>();
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
]);

/**
 * Orgs whose compliance alerts the user may still read: a member whose role is
 * inside the organization's configured alert audience.
 */
async function alertOrganizationIds(userId: string): Promise<string[]> {
	const memberships = await db.query.userOrganization.findMany({
		columns: { organizationId: true, role: true },
		where: { userId },
		with: { organization: { columns: { complianceAlertSettings: true } } },
	});
	return memberships
		.filter((m) => {
			const audience =
				m.organization?.complianceAlertSettings?.recipientAudience;
			return !!audience && isInAlertAudience(m.role, audience);
		})
		.map((m) => m.organizationId);
}

async function visibility(userId: string) {
	const [scope, organizationIds] = await Promise.all([
		getUserProjectIds(userId).then((ids) => getApiKeyScope(userId, ids)),
		alertOrganizationIds(userId),
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
			inArray(notification.organizationId, organizationIds),
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
					};
				}
				const row = saved.find((p) => p.type === category);
				return {
					category,
					inApp: row?.inApp ?? orgAlertTypes.has(category),
					email:
						(row?.email ?? (orgAlertTypes.has(category) && emailDefault)) &&
						!isSuppressed,
					budgetThreshold:
						category === "budget" ? (row?.budgetThreshold ?? 80) : null,
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
				})
				.onConflictDoUpdate({
					target: [notificationPreference.userId, notificationPreference.type],
					set: {
						inApp: value.inApp ?? false,
						email: value.email,
						budgetThreshold: value.budgetThreshold ?? 80,
					},
				});
		}

		return c.json(value);
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
		const items = await db
			.select()
			.from(notification)
			.where(filter)
			.orderBy(sql`${notification.createdAt} DESC`)
			.limit(50);
		const [count] = await db
			.select({ value: sql<number>`count(*)::int` })
			.from(notification)
			.where(and(filter, isNull(notification.readAt)));
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
