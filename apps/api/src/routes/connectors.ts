import { createHash, randomBytes } from "node:crypto";

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import { connectorAvailable, shopDomain } from "@/lib/connectors/catalogue.js";
import { openConnector, sealConnector } from "@/lib/connectors/crypto.js";
import {
	beginAuthorization,
	credentialsSchema,
	finishAuthorization,
} from "@/lib/connectors/oauth.js";
import {
	callConnectorTool,
	listConnectorTools,
} from "@/lib/connectors/tools.js";

import { and, db, eq, gt, lt, tables, shortid } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	loungeConnectorIds,
	loungeConnectors,
} from "@llmgateway/shared/lounge-connectors";

import type { ConnectorCredentials } from "@/lib/connectors/oauth.js";
import type { ServerTypes } from "@/vars.js";

export const connectors = new OpenAPIHono<ServerTypes>();
const connectorId = z.enum(loungeConnectorIds);
const params = z.object({ connectorId });
const ok = {
	description: "Success",
	content: {
		"application/json": { schema: z.object({ success: z.boolean() }) },
	},
};

const errorResponse = {
	description: "Connector request failed",
	content: {
		"application/json": { schema: z.object({ message: z.string() }) },
	},
};
const errorResponses = {
	400: errorResponse,
	401: errorResponse,
	404: errorResponse,
	409: errorResponse,
	502: errorResponse,
	503: errorResponse,
};

connectors.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Connectors"],
		responses: {
			...errorResponses,
			200: {
				description: "Available Lounge connectors",
				content: {
					"application/json": {
						schema: z.object({
							connectors: z.array(
								z.object({
									id: connectorId,
									name: z.string(),
									description: z.string(),
									available: z.boolean(),
									connected: z.boolean(),
									enabled: z.boolean(),
								}),
							),
						}),
					},
				},
			},
		},
	}),
	async (c) => {
		const connections = await db.query.loungeConnection.findMany({
			where: { userId: c.get("user")!.id },
			columns: { connectorId: true, enabled: true },
		});
		return c.json(
			{
				connectors: loungeConnectorIds.map((id) => {
					const connection = connections.find(
						(entry) => entry.connectorId === id,
					);
					return {
						id,
						...loungeConnectors[id],
						available: connectorAvailable(id),
						connected: Boolean(connection),
						enabled: connection?.enabled ?? false,
					};
				}),
			},
			200,
		);
	},
);

connectors.openapi(
	createRoute({
		method: "post",
		path: "/{connectorId}/authorize",
		tags: ["Connectors"],
		request: {
			params,
			body: {
				required: true,
				content: {
					"application/json": {
						schema: z
							.object({
								shop: z.string().max(255).optional(),
								returnTo: z
									.string()
									.max(2048)
									.regex(/^\/(?!\/)/)
									.refine(
										(path) =>
											!path.includes("\\") &&
											new URL(path, "https://lounge.invalid").origin ===
												"https://lounge.invalid",
									)
									.optional(),
							})
							.strict(),
					},
				},
			},
		},
		responses: {
			...errorResponses,
			200: {
				description: "OAuth consent URL",
				content: {
					"application/json": { schema: z.object({ url: z.string() }) },
				},
			},
		},
	}),
	async (c) => {
		const { connectorId: id } = c.req.valid("param");
		if (!connectorAvailable(id)) {
			throw new HTTPException(503, {
				message: "This connector is not configured yet",
			});
		}
		const userId = c.get("user")!.id;
		const state = randomBytes(32).toString("base64url");
		const stateHash = createHash("sha256").update(state).digest("hex");
		const existing = await db.query.loungeConnection.findFirst({
			where: { userId, connectorId: id },
		});
		const previous = existing
			? credentialsSchema.parse(openConnector(existing.credentials, userId, id))
			: undefined;
		const credentials: ConnectorCredentials = {
			client: previous?.client,
			returnTo: c.req.valid("json").returnTo,
		};
		if (id === "shopify") {
			credentials.shop = shopDomain(
				c.req.valid("json").shop || previous?.shop || "",
			);
		}
		const url = await beginAuthorization(id, state, credentials);
		await db
			.delete(tables.loungeConnectorAuthorization)
			.where(lt(tables.loungeConnectorAuthorization.expiresAt, new Date()));
		await db.insert(tables.loungeConnectorAuthorization).values({
			id: stateHash,
			userId,
			sessionId: c.get("session")!.id,
			connectorId: id,
			credentials: sealConnector(credentials, userId, stateHash),
			expiresAt: new Date(Date.now() + 600_000),
		});
		c.header("Cache-Control", "no-store");
		return c.json({ url }, 200);
	},
);

connectors.openapi(
	createRoute({
		method: "get",
		path: "/{connectorId}/callback",
		tags: ["Connectors"],
		request: {
			params,
			query: z.object({
				state: z.string().min(32).max(128),
				code: z.string().min(1).max(4096).optional(),
				error: z.string().max(255).optional(),
			}),
		},
		responses: {
			...errorResponses,
			302: { description: "Return to The Lounge" },
		},
	}),
	async (c) => {
		const { connectorId: id } = c.req.valid("param");
		const { state, code, error } = c.req.valid("query");
		const userId = c.get("user")!.id;
		const stateHash = createHash("sha256").update(state).digest("hex");
		const [pending] = await db
			.update(tables.loungeConnectorAuthorization)
			.set({ consumed: true })
			.where(
				and(
					eq(tables.loungeConnectorAuthorization.consumed, false),
					eq(tables.loungeConnectorAuthorization.id, stateHash),
					eq(tables.loungeConnectorAuthorization.userId, userId),
					eq(
						tables.loungeConnectorAuthorization.sessionId,
						c.get("session")!.id,
					),
					eq(tables.loungeConnectorAuthorization.connectorId, id),
					gt(tables.loungeConnectorAuthorization.expiresAt, new Date()),
				),
			)
			.returning();
		if (!pending) {
			throw new HTTPException(400, {
				message: "Authorization expired or already used. Try connecting again.",
			});
		}
		const pendingCredentials = credentialsSchema.parse(
			openConnector(pending.credentials, userId, pending.id),
		);
		const returnUrl = new URL(
			pendingCredentials.returnTo ?? "/",
			process.env.PLAYGROUND_URL ?? "http://localhost:3003",
		);
		returnUrl.searchParams.set("connector", id);
		c.header("Cache-Control", "no-store");
		c.header("Referrer-Policy", "no-referrer");
		if (error) {
			returnUrl.searchParams.set("connector_status", "cancelled");
			return c.redirect(returnUrl.toString(), 302);
		}
		if (!code) {
			throw new HTTPException(400, { message: "Missing authorization code" });
		}
		const credentials = credentialsSchema.parse(
			openConnector(pending.credentials, userId, pending.id),
		);
		try {
			await finishAuthorization(
				id,
				credentials,
				code,
				new URL(c.req.url).searchParams,
			);
		} catch {
			logger.warn("Lounge connector authorization failed", { connector: id });
			returnUrl.searchParams.set("connector_status", "failed");
			return c.redirect(returnUrl.toString(), 302);
		}
		await db.transaction(async (tx) => {
			const [active] = await tx
				.delete(tables.loungeConnectorAuthorization)
				.where(eq(tables.loungeConnectorAuthorization.id, pending.id))
				.returning();
			if (!active) {
				throw new HTTPException(409, {
					message: "Authorization was cancelled. Connect again.",
				});
			}
			const connectionId = shortid();
			await tx
				.insert(tables.loungeConnection)
				.values({
					id: connectionId,
					userId,
					connectorId: id,
					credentials: sealConnector(credentials, userId, id),
				})
				.onConflictDoUpdate({
					target: [
						tables.loungeConnection.userId,
						tables.loungeConnection.connectorId,
					],
					set: {
						credentials: sealConnector(credentials, userId, id),
						enabled: true,
						updatedAt: new Date(),
					},
				});
		});
		returnUrl.searchParams.set("connector_status", "connected");
		return c.redirect(returnUrl.toString(), 302);
	},
);

connectors.openapi(
	createRoute({
		method: "patch",
		path: "/{connectorId}",
		tags: ["Connectors"],
		request: {
			params,
			body: {
				required: true,
				content: {
					"application/json": {
						schema: z.object({ enabled: z.boolean() }).strict(),
					},
				},
			},
		},
		responses: { ...errorResponses, 200: ok },
	}),
	async (c) => {
		const rows = await db
			.update(tables.loungeConnection)
			.set(c.req.valid("json"))
			.where(
				and(
					eq(tables.loungeConnection.userId, c.get("user")!.id),
					eq(
						tables.loungeConnection.connectorId,
						c.req.valid("param").connectorId,
					),
				),
			)
			.returning({ id: tables.loungeConnection.id });
		if (!rows.length) {
			throw new HTTPException(404, { message: "Connector is not connected" });
		}
		return c.json({ success: true }, 200);
	},
);

connectors.openapi(
	createRoute({
		method: "delete",
		path: "/{connectorId}",
		tags: ["Connectors"],
		request: { params },
		responses: { ...errorResponses, 200: ok },
	}),
	async (c) => {
		const userId = c.get("user")!.id;
		const id = c.req.valid("param").connectorId;
		await db.transaction(async (tx) => {
			await tx
				.delete(tables.loungeConnection)
				.where(
					and(
						eq(tables.loungeConnection.userId, userId),
						eq(tables.loungeConnection.connectorId, id),
					),
				);
			await tx
				.delete(tables.loungeConnectorAuthorization)
				.where(
					and(
						eq(tables.loungeConnectorAuthorization.userId, userId),
						eq(tables.loungeConnectorAuthorization.connectorId, id),
					),
				);
		});
		return c.json({ success: true }, 200);
	},
);

connectors.openapi(
	createRoute({
		method: "post",
		path: "/tools",
		tags: ["Connectors"],
		request: {
			body: {
				required: true,
				content: {
					"application/json": {
						schema: z
							.object({ connectors: z.array(connectorId).max(11) })
							.strict(),
					},
				},
			},
		},
		responses: {
			...errorResponses,
			200: {
				description: "Tools for the selected connections",
				content: {
					"application/json": {
						schema: z.object({
							tools: z.array(
								z.object({
									connectorId,
									name: z.string(),
									description: z.string(),
									inputSchema: z.record(z.unknown()),
								}),
							),
						}),
					},
				},
			},
		},
	}),
	async (c) =>
		c.json(
			{
				tools: await listConnectorTools(c.get("user")!.id, [
					...new Set(c.req.valid("json").connectors),
				]),
			},
			200,
		),
);

connectors.openapi(
	createRoute({
		method: "post",
		path: "/{connectorId}/tools/{toolName}",
		tags: ["Connectors"],
		request: {
			params: params.extend({
				toolName: z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/),
			}),
			body: {
				required: true,
				content: {
					"application/json": {
						schema: z.object({ input: z.record(z.unknown()) }).strict(),
					},
				},
			},
		},
		responses: {
			...errorResponses,
			200: {
				description: "Connector tool result",
				content: {
					"application/json": { schema: z.object({ result: z.string() }) },
				},
			},
		},
	}),
	async (c) => {
		const { connectorId: id, toolName } = c.req.valid("param");
		return c.json(
			{
				result: JSON.stringify(
					await callConnectorTool(
						c.get("user")!.id,
						id,
						toolName,
						c.req.valid("json").input,
					),
				),
			},
			200,
		);
	},
);
