import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	buildDataStreamTestEvent,
	DATADOG_SITES,
	DataStreamConfigError,
	decryptDataStreamSecret,
	deliverDataStreamBatch,
	encryptDataStreamSecret,
	validateDataStreamConfig,
	type DataStreamSecret,
} from "@llmgateway/actions";
import { logAuditEvent } from "@llmgateway/audit";
import {
	dataStreamDestinations,
	dataStreamSources,
	db,
	desc,
	eq,
	shortid,
	tables,
	type InferSelectModel,
} from "@llmgateway/db";
import { hasOrganizationEnterpriseAccess } from "@llmgateway/shared/enterprise-license";
import { isOrganizationAdmin } from "@llmgateway/shared/organization-roles";

import type { ServerTypes } from "@/vars.js";

export const dataStreams = new OpenAPIHono<ServerTypes>();

const MAX_STREAMS_PER_ORG = 20;
const MAX_REPLAY_DAYS = 30;
const DAY_MS = 86_400_000;

const configSchema = z
	.object({
		url: z.string().url().max(2048).optional(),
		site: z.enum(DATADOG_SITES).optional(),
		service: z.string().trim().max(100).optional(),
		index: z.string().trim().max(100).optional(),
		sourcetype: z.string().trim().max(100).optional(),
		bucket: z.string().trim().max(63).optional(),
		region: z.string().trim().max(32).optional(),
		prefix: z.string().trim().max(200).optional(),
		endpoint: z.string().url().max(2048).optional(),
		accessKeyId: z.string().trim().max(128).optional(),
		includePayloads: z.boolean().optional(),
	})
	.strict();

const secretSchema = z
	.object({
		token: z.string().min(1).max(4096).optional(),
		apiKey: z.string().min(1).max(4096).optional(),
		secretAccessKey: z.string().min(1).max(4096).optional(),
		signingSecret: z.string().min(16).max(4096).optional(),
	})
	.strict();

const streamSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	organizationId: z.string(),
	projectId: z.string().nullable(),
	name: z.string(),
	source: z.enum(dataStreamSources),
	destination: z.enum(dataStreamDestinations),
	config: configSchema.extend({ site: z.string().optional() }),
	secretFields: z.array(z.string()),
	enabled: z.boolean(),
	cursorCreatedAt: z.date(),
	replayFrom: z.date().nullable(),
	replayTo: z.date().nullable(),
	deliveredCount: z.number(),
	lastDeliveredAt: z.date().nullable(),
	lastError: z.string().nullable(),
	lastErrorAt: z.date().nullable(),
});

type StreamRow = InferSelectModel<typeof tables.dataStream>;

function serialize(row: StreamRow) {
	const secret = decryptDataStreamSecret(
		row.secret,
		row.id,
		row.organizationId,
	);
	return {
		id: row.id,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		organizationId: row.organizationId,
		projectId: row.projectId,
		name: row.name,
		source: row.source,
		destination: row.destination,
		config: row.config,
		secretFields: Object.keys(secret).filter(
			(key) => secret[key as keyof DataStreamSecret],
		),
		enabled: row.enabled,
		cursorCreatedAt: row.cursorCreatedAt,
		replayFrom: row.replayFrom,
		replayTo: row.replayTo,
		deliveredCount: row.deliveredCount,
		lastDeliveredAt: row.lastDeliveredAt,
		lastError: row.lastError,
		lastErrorAt: row.lastErrorAt,
	};
}

async function requireStreamAdmin(
	userId: string | undefined,
	organizationId: string,
): Promise<void> {
	if (!userId) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const membership = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: userId },
			organizationId: { eq: organizationId },
		},
		with: { organization: true },
	});
	if (
		!membership?.organization ||
		membership.organization.status === "deleted"
	) {
		throw new HTTPException(404, { message: "Organization not found" });
	}
	if (!isOrganizationAdmin(membership.role)) {
		throw new HTTPException(403, {
			message: "Only organization owners and admins can manage data streams",
		});
	}
	if (
		!hasOrganizationEnterpriseAccess(
			membership.organization.id,
			membership.organization.plan,
		)
	) {
		throw new HTTPException(403, {
			message: "Data streams require an enterprise plan",
		});
	}
}

async function loadStream(userId: string | undefined, id: string) {
	const [row] = await db
		.select()
		.from(tables.dataStream)
		.where(eq(tables.dataStream.id, id))
		.limit(1);
	if (!row) {
		throw new HTTPException(404, { message: "Data stream not found" });
	}
	await requireStreamAdmin(userId, row.organizationId);
	return row;
}

function assertValid(
	destination: StreamRow["destination"],
	config: StreamRow["config"],
	secret: DataStreamSecret,
) {
	try {
		validateDataStreamConfig(destination, config, secret);
	} catch (error) {
		if (error instanceof DataStreamConfigError) {
			throw new HTTPException(400, { message: error.message });
		}
		throw error;
	}
}

const streamResponse = {
	200: {
		content: {
			"application/json": { schema: z.object({ stream: streamSchema }) },
		},
		description: "Data stream.",
	},
};

const listRoute = createRoute({
	method: "get",
	path: "/",
	request: { query: z.object({ organizationId: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ streams: z.array(streamSchema) }),
				},
			},
			description: "Data streams of the organization.",
		},
	},
});

dataStreams.openapi(listRoute, async (c) => {
	const { organizationId } = c.req.valid("query");
	await requireStreamAdmin(c.get("user")?.id, organizationId);
	const rows = await db
		.select()
		.from(tables.dataStream)
		.where(eq(tables.dataStream.organizationId, organizationId))
		.orderBy(desc(tables.dataStream.createdAt));
	return c.json({ streams: rows.map(serialize) });
});

const createStreamRoute = createRoute({
	method: "post",
	path: "/",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						organizationId: z.string(),
						projectId: z.string().nullable().optional(),
						name: z.string().trim().min(1).max(100),
						source: z.enum(dataStreamSources),
						destination: z.enum(dataStreamDestinations),
						config: configSchema,
						secret: secretSchema,
					}),
				},
			},
		},
	},
	responses: streamResponse,
});

dataStreams.openapi(createStreamRoute, async (c) => {
	const user = c.get("user");
	const body = c.req.valid("json");
	await requireStreamAdmin(user?.id, body.organizationId);
	if (body.projectId) {
		if (body.source !== "request_logs") {
			throw new HTTPException(400, {
				message: "Only request-log streams can be scoped to a project",
			});
		}
		const project = await db.query.project.findFirst({
			where: {
				id: { eq: body.projectId },
				organizationId: { eq: body.organizationId },
			},
		});
		if (!project || project.status === "deleted") {
			throw new HTTPException(404, { message: "Project not found" });
		}
	}
	const existing = await db
		.select({ id: tables.dataStream.id })
		.from(tables.dataStream)
		.where(eq(tables.dataStream.organizationId, body.organizationId));
	if (existing.length >= MAX_STREAMS_PER_ORG) {
		throw new HTTPException(400, {
			message: `Organizations can have at most ${MAX_STREAMS_PER_ORG} data streams`,
		});
	}
	assertValid(body.destination, body.config, body.secret);
	const id = shortid();
	const [row] = await db
		.insert(tables.dataStream)
		.values({
			id,
			organizationId: body.organizationId,
			projectId: body.projectId ?? null,
			name: body.name,
			source: body.source,
			destination: body.destination,
			config: body.config,
			secret: encryptDataStreamSecret(body.secret, id, body.organizationId),
		})
		.returning();
	await logAuditEvent({
		organizationId: body.organizationId,
		userId: user!.id,
		action: "data_stream.create",
		resourceType: "data_stream",
		resourceId: id,
		metadata: {
			resourceName: body.name,
			source: body.source,
			destination: body.destination,
		},
	});
	return c.json({ stream: serialize(row) });
});

const updateStreamRoute = createRoute({
	method: "patch",
	path: "/{id}",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						name: z.string().trim().min(1).max(100).optional(),
						enabled: z.boolean().optional(),
						config: configSchema.optional(),
						secret: secretSchema.optional(),
					}),
				},
			},
		},
	},
	responses: streamResponse,
});

dataStreams.openapi(updateStreamRoute, async (c) => {
	const user = c.get("user");
	const existing = await loadStream(user?.id, c.req.valid("param").id);
	const body = c.req.valid("json");
	const secret = {
		...decryptDataStreamSecret(
			existing.secret,
			existing.id,
			existing.organizationId,
		),
		...(body.secret ?? {}),
	};
	const config = body.config ?? existing.config;
	assertValid(existing.destination, config, secret);
	const [row] = await db
		.update(tables.dataStream)
		.set({
			...(body.name !== undefined ? { name: body.name } : {}),
			...(body.enabled !== undefined
				? { enabled: body.enabled, lastError: null, lastErrorAt: null }
				: {}),
			config,
			secret: encryptDataStreamSecret(
				secret,
				existing.id,
				existing.organizationId,
			),
		})
		.where(eq(tables.dataStream.id, existing.id))
		.returning();
	await logAuditEvent({
		organizationId: existing.organizationId,
		userId: user!.id,
		action: "data_stream.update",
		resourceType: "data_stream",
		resourceId: existing.id,
		metadata: {
			resourceName: row.name,
			...(body.enabled !== undefined
				? { changes: { enabled: { old: existing.enabled, new: body.enabled } } }
				: {}),
			secretRotated: body.secret !== undefined,
		},
	});
	return c.json({ stream: serialize(row) });
});

const deleteStreamRoute = createRoute({
	method: "delete",
	path: "/{id}",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ success: z.boolean() }) },
			},
			description: "Deleted.",
		},
	},
});

dataStreams.openapi(deleteStreamRoute, async (c) => {
	const user = c.get("user");
	const existing = await loadStream(user?.id, c.req.valid("param").id);
	await db
		.delete(tables.dataStream)
		.where(eq(tables.dataStream.id, existing.id));
	await logAuditEvent({
		organizationId: existing.organizationId,
		userId: user!.id,
		action: "data_stream.delete",
		resourceType: "data_stream",
		resourceId: existing.id,
		metadata: { resourceName: existing.name },
	});
	return c.json({ success: true });
});

const testStreamRoute = createRoute({
	method: "post",
	path: "/{id}/test",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						error: z.string().nullable(),
					}),
				},
			},
			description: "Result of delivering one synthetic event.",
		},
	},
});

dataStreams.openapi(testStreamRoute, async (c) => {
	const existing = await loadStream(c.get("user")?.id, c.req.valid("param").id);
	const secret = decryptDataStreamSecret(
		existing.secret,
		existing.id,
		existing.organizationId,
	);
	try {
		await deliverDataStreamBatch(existing, secret, [
			buildDataStreamTestEvent(existing),
		]);
		return c.json({ success: true, error: null });
	} catch (error) {
		return c.json({
			success: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
});

const replayStreamRoute = createRoute({
	method: "post",
	path: "/{id}/replay",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						from: z.coerce.date(),
						to: z.coerce.date(),
					}),
				},
			},
		},
	},
	responses: streamResponse,
});

dataStreams.openapi(replayStreamRoute, async (c) => {
	const user = c.get("user");
	const existing = await loadStream(user?.id, c.req.valid("param").id);
	const { from, to } = c.req.valid("json");
	const now = new Date();
	if (from >= to) {
		throw new HTTPException(400, { message: "'from' must be before 'to'" });
	}
	if (to > now) {
		throw new HTTPException(400, { message: "'to' cannot be in the future" });
	}
	if (to.getTime() - from.getTime() > MAX_REPLAY_DAYS * DAY_MS) {
		throw new HTTPException(400, {
			message: `Replay windows are limited to ${MAX_REPLAY_DAYS} days`,
		});
	}
	const [row] = await db
		.update(tables.dataStream)
		.set({
			replayFrom: from,
			replayTo: to,
			replayCursorCreatedAt: null,
			replayCursorId: null,
		})
		.where(eq(tables.dataStream.id, existing.id))
		.returning();
	await logAuditEvent({
		organizationId: existing.organizationId,
		userId: user!.id,
		action: "data_stream.replay",
		resourceType: "data_stream",
		resourceId: existing.id,
		metadata: {
			resourceName: existing.name,
			from: from.toISOString(),
			to: to.toISOString(),
		},
	});
	return c.json({ stream: serialize(row) });
});
