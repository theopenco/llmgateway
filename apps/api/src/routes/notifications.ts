import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { getApiKeyScope, getUserProjectIds } from "@/utils/authorization.js";

import {
	and,
	db,
	eq,
	inArray,
	isNull,
	notification,
	notificationPreference,
	notificationTypes,
	or,
	sql,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const notifications = new OpenAPIHono<ServerTypes>();
const preferenceSchema = z.object({
	type: z.enum(notificationTypes),
	inApp: z.boolean(),
	email: z.boolean(),
	budgetThreshold: z.number().int().min(50).max(100),
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

async function visibility(userId: string) {
	const scope = await getApiKeyScope(userId, await getUserProjectIds(userId));
	return and(
		eq(notification.userId, userId),
		eq(notification.inApp, true),
		or(
			inArray(notification.projectId, scope.privilegedProjectIds),
			and(
				inArray(notification.projectId, scope.restrictedProjectIds),
				inArray(notification.apiKeyId, scope.ownApiKeyIds),
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
				description: "Your alert preferences",
				content: {
					"application/json": {
						schema: z.object({ preferences: z.array(preferenceSchema) }),
					},
				},
			},
		},
	}),
	async (c) => {
		const userId = c.get("user")!.id;
		const saved = await db.query.notificationPreference.findMany({
			where: { userId },
		});
		return c.json({
			preferences: notificationTypes.map((type) => {
				const row = saved.find((p) => p.type === type);
				return {
					type,
					inApp: row?.inApp ?? false,
					email: row?.email ?? false,
					budgetThreshold: row?.budgetThreshold ?? 80,
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
		if (value.email) {
			const recipient = await db.query.user.findFirst({
				where: { id: userId, emailVerified: true },
			});
			if (!recipient) {
				throw new HTTPException(403, {
					message: "Verify your email before enabling email alerts",
				});
			}
		}
		await db
			.insert(notificationPreference)
			.values({ userId, ...value })
			.onConflictDoUpdate({
				target: [notificationPreference.userId, notificationPreference.type],
				set: value,
			});
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
