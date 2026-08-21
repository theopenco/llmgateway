import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { adminAuthMiddleware } from "@/middleware/admin.js";

import { and, countDistinct, db, eq, tables } from "@llmgateway/db";
import { getEnterpriseLicenseStatus } from "@llmgateway/shared/enterprise-license";

import type { ServerTypes } from "@/vars.js";

export const adminLicense = new OpenAPIHono<ServerTypes>();

adminLicense.use("/*", adminAuthMiddleware);

const getLicense = createRoute({
	method: "get",
	path: "/license",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						status: z.enum([
							"missing",
							"invalid",
							"not_yet_valid",
							"active",
							"grace",
							"expired",
							"development",
						]),
						enterpriseEnabled: z.boolean(),
						whiteLabelEnabled: z.boolean(),
						kind: z.enum(["enterprise", "white_label"]).nullable(),
						organizationId: z.string().nullable(),
						expiresAt: z.string().nullable(),
						graceEndsAt: z.string().nullable(),
						maxSeats: z.number().int().nullable(),
						seatsUsed: z.number().int(),
						seatsRemaining: z.number().int().nullable(),
					}),
				},
			},
			description: "Enterprise deployment license status.",
		},
	},
});

adminLicense.openapi(getLicense, async (c) => {
	const license = getEnterpriseLicenseStatus();
	let seatsUsed = 0;
	if (license.kind || license.status === "development") {
		const [result] = await db
			.select({ seatsUsed: countDistinct(tables.userOrganization.userId) })
			.from(tables.userOrganization)
			.innerJoin(
				tables.organization,
				eq(tables.userOrganization.organizationId, tables.organization.id),
			)
			.where(
				and(
					eq(tables.organization.plan, "enterprise"),
					eq(tables.organization.kind, "default"),
					eq(tables.organization.status, "active"),
					license.kind === "enterprise" && license.organizationId
						? eq(tables.organization.id, license.organizationId)
						: undefined,
				),
			);
		seatsUsed = result?.seatsUsed ?? 0;
	}

	return c.json({
		status: license.status,
		enterpriseEnabled: license.enterpriseEnabled,
		whiteLabelEnabled:
			license.enterpriseEnabled && license.kind === "white_label",
		kind: license.kind,
		organizationId: license.organizationId,
		expiresAt: license.expiresAt,
		graceEndsAt: license.graceEndsAt,
		maxSeats: license.maxSeats,
		seatsUsed,
		seatsRemaining:
			license.maxSeats === null
				? null
				: Math.max(0, license.maxSeats - seatsUsed),
	});
});
