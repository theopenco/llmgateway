import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	buildDataStreamTestEvent,
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
	})
	.strict();

const secretSchema = z
	.object({
		signingSecret: z.string().min(16).max(4096).optional(),
		// null removes the token; the signing secret is required and can only
		// be replaced.
		token: z.string().min(1).max(4096).nullable().optional(),
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
	config: configSchema,
	secretFields: z.array(z.string()),
	enabled: z.boolean(),
	pausedReason: z.string().nullable(),
	cursorCreatedAt: z.date(),
	replayFrom: z.date().nullable(),
	replayTo: z.date().nullable(),
	deliveredCount: z.number(),
	lastDeliveredAt: z.date().nullable(),
	lastError: z.string().nullable(),
	lastErrorAt: z.date().nullable(),
	failureCount: z.number(),
});

type StreamRow = InferSelectModel<typeof tables.dataStream>;
type OrganizationRow = InferSelectModel<typeof tables.organization>;

function readSecret(row: StreamRow): DataStreamSecret {
	try {
		return decryptDataStreamSecret(row.secret, row.id, row.organizationId);
	} catch {
		// A secret that no longer decrypts (keyring rotation) must not take the
		// whole list down; the stream shows no secret fields and fails to deliver
		// with a clear error until it is rotated.
		return {};
	}
}

function serialize(row: StreamRow) {
	const secret = readSecret(row);
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
		pausedReason: row.pausedReason,
		// Stored as UTC Postgres text to keep microseconds.
		cursorCreatedAt: new Date(`${row.cursorCreatedAt}Z`),
		replayFrom: row.replayFrom,
		replayTo: row.replayTo,
		deliveredCount: row.deliveredCount,
		lastDeliveredAt: row.lastDeliveredAt,
		lastError: row.lastError,
		lastErrorAt: row.lastErrorAt,
		failureCount: row.failureCount,
	};
}

/**
 * Owners and admins of an Enterprise organization that a platform admin has
 * opened data streams for. Request-log export is a second, separate switch
 * because it reads the request log table on a schedule.
 */
async function requireStreamAdmin(
	userId: string | undefined,
	organizationId: string,
): Promise<OrganizationRow> {
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
	if (!membership.organization.dataStreamsEnabled) {
		throw new HTTPException(403, {
			message:
				"Data streams are not enabled for this organization yet. Contact us to enable them.",
		});
	}
	return membership.organization;
}

function requireSourceAllowed(
	organization: OrganizationRow,
	source: StreamRow["source"],
) {
	if (source === "request_logs" && !organization.requestLogExportEnabled) {
		throw new HTTPException(403, {
			message:
				"Request log export is not enabled for this organization yet. Contact us to enable it.",
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
	const organization = await requireStreamAdmin(userId, row.organizationId);
	return { row, organization };
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
					schema: z.object({
						streams: z.array(streamSchema),
						requestLogExportEnabled: z.boolean(),
					}),
				},
			},
			description: "Data streams of the organization.",
		},
	},
});

dataStreams.openapi(listRoute, async (c) => {
	const { organizationId } = c.req.valid("query");
	const organization = await requireStreamAdmin(
		c.get("user")?.id,
		organizationId,
	);
	const rows = await db
		.select()
		.from(tables.dataStream)
		.where(eq(tables.dataStream.organizationId, organizationId))
		.orderBy(desc(tables.dataStream.createdAt));
	return c.json({
		streams: rows.map(serialize),
		requestLogExportEnabled: organization.requestLogExportEnabled,
	});
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
	const organization = await requireStreamAdmin(user?.id, body.organizationId);
	requireSourceAllowed(organization, body.source);
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
	const secret: DataStreamSecret = {
		signingSecret: body.secret.signingSecret,
		...(body.secret.token ? { token: body.secret.token } : {}),
	};
	assertValid(body.destination, body.config, secret);
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
			secret: encryptDataStreamSecret(secret, id, body.organizationId),
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
	const { row: existing, organization } = await loadStream(
		user?.id,
		c.req.valid("param").id,
	);
	const body = c.req.valid("json");
	if (body.enabled) {
		requireSourceAllowed(organization, existing.source);
	}
	const secret: DataStreamSecret = { ...readSecret(existing) };
	if (body.secret?.signingSecret !== undefined) {
		secret.signingSecret = body.secret.signingSecret;
	}
	if (body.secret?.token === null) {
		delete secret.token;
	} else if (body.secret?.token !== undefined) {
		secret.token = body.secret.token;
	}
	// Fields left out keep their value, so a partial config cannot silently
	// drop one.
	const config = { ...existing.config, ...body.config };
	assertValid(existing.destination, config, secret);
	const [row] = await db
		.update(tables.dataStream)
		.set({
			...(body.name !== undefined ? { name: body.name } : {}),
			// Resuming clears the failure state so delivery is retried at once.
			...(body.enabled !== undefined
				? {
						enabled: body.enabled,
						pausedReason: null,
						lastError: null,
						lastErrorAt: null,
						failureCount: 0,
						rejectionCount: 0,
					}
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
	const { row: existing } = await loadStream(user?.id, c.req.valid("param").id);
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
	const { row: existing } = await loadStream(
		c.get("user")?.id,
		c.req.valid("param").id,
	);
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
	const { row: existing, organization } = await loadStream(
		user?.id,
		c.req.valid("param").id,
	);
	requireSourceAllowed(organization, existing.source);
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
