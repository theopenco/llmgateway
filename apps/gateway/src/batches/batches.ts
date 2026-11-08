import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";

import { standardErrorResponses } from "@/lib/error-schemas.js";
import { extractApiToken } from "@/lib/extract-api-token.js";
import { getAuthenticatedReadAccess } from "@/lib/gateway-read-access.js";

import {
	and,
	db,
	deleteBatchRequests,
	desc,
	eq,
	gt,
	inArray,
	lt,
	or,
	sql,
	tables,
	type InferSelectModel,
	type SQL,
} from "@llmgateway/db";
import {
	BATCH_COMPLETION_WINDOW,
	BATCH_COMPLETION_WINDOW_MS,
	BATCH_ENDPOINT_PATHS,
	BATCH_FILE_TTL_MS,
	BATCH_MAX_FILE_BYTES,
	buildBatchOutputLine,
	newBatchFileId,
	newBatchId,
} from "@llmgateway/shared/batch";
import { encryptProviderKey } from "@llmgateway/shared/provider-key-crypto";

import {
	batchObjectSchema,
	fileObjectSchema,
	listSchema,
	toBatchObject,
	toFileObject,
} from "./schemas.js";

import type { ServerTypes } from "@/vars.js";
import type { Context, MiddlewareHandler } from "hono";

export const files = new OpenAPIHono<ServerTypes>();
export const batches = new OpenAPIHono<ServerTypes>();

const OUTPUT_PAGE_SIZE = 1000;
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const BATCH_MAX_PROJECT_STORAGE_BYTES = 10 * 1024 * 1024 * 1024;
const MAX_METADATA_KEYS = 16;
const MAX_METADATA_KEY_LENGTH = 64;
const MAX_METADATA_VALUE_LENGTH = 512;

const fileColumns = {
	id: tables.batchFile.id,
	createdAt: tables.batchFile.createdAt,
	organizationId: tables.batchFile.organizationId,
	projectId: tables.batchFile.projectId,
	apiKeyId: tables.batchFile.apiKeyId,
	purpose: tables.batchFile.purpose,
	filename: tables.batchFile.filename,
	bytes: tables.batchFile.bytes,
	batchId: tables.batchFile.batchId,
	expiresAt: tables.batchFile.expiresAt,
};

const errorResponses = standardErrorResponses();

type BatchAccess = Awaited<ReturnType<typeof getAuthenticatedReadAccess>>;

const accessByRequest = new WeakMap<Request, BatchAccess>();

async function requireBatchAccess(c: Context<ServerTypes>) {
	const cached = accessByRequest.get(c.req.raw);
	if (cached) {
		return cached;
	}
	const access = await getAuthenticatedReadAccess(c);
	accessByRequest.set(c.req.raw, access);
	return access;
}

// Authenticates before the multipart validator buffers the upload.
const authenticateFirst: MiddlewareHandler<ServerTypes> = async (c, next) => {
	await requireBatchAccess(c);
	await next();
};

async function assertProjectStorageAvailable(projectId: string, bytes: number) {
	const [row] = await db
		.select({
			bytes: sql<string>`coalesce(sum(${tables.batchFile.bytes}), 0)`,
		})
		.from(tables.batchFile)
		.where(
			and(
				eq(tables.batchFile.projectId, projectId),
				eq(tables.batchFile.purpose, "batch"),
				gt(tables.batchFile.expiresAt, new Date()),
			),
		);
	if (Number(row?.bytes ?? 0) + bytes > BATCH_MAX_PROJECT_STORAGE_BYTES) {
		throw new HTTPException(413, {
			message:
				"This project's batch files exceed 10 GB. Delete files you no longer need.",
		});
	}
}

function invalidRequest(message: string): never {
	throw new HTTPException(400, { message });
}

function notFound(kind: "File" | "Batch", id: string): never {
	throw new HTTPException(404, {
		message: `No ${kind.toLowerCase()} with id ${id}`,
	});
}

function clampLimit(raw: string | undefined, fallback: number, max: number) {
	const value = raw === undefined ? fallback : Number(raw);
	if (!Number.isInteger(value) || value < 1 || value > max) {
		invalidRequest(`limit must be an integer between 1 and ${max}`);
	}
	return value;
}

function afterCursor(
	table: typeof tables.batch | typeof tables.batchFile,
	after: { id: string; createdAt: Date } | undefined,
): SQL | undefined {
	if (!after) {
		return undefined;
	}
	return or(
		lt(table.createdAt, after.createdAt),
		and(eq(table.createdAt, after.createdAt), lt(table.id, after.id)),
	);
}

function toList<T extends { id: string }>(rows: T[], limit: number) {
	const data = rows.slice(0, limit);
	return {
		object: "list" as const,
		data,
		first_id: data[0]?.id ?? null,
		last_id: data.at(-1)?.id ?? null,
		has_more: rows.length > limit,
	};
}

const uploadFile = createRoute({
	operationId: "v1_files_create",
	summary: "Upload file",
	description:
		"Uploads a JSONL file of requests for the Batch API. Use `purpose=batch`. Files are limited to 50 MB and expire after 30 days.",
	method: "post",
	path: "/",
	middleware: [
		authenticateFirst,
		bodyLimit({
			maxSize: BATCH_MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES,
			onError: () => {
				throw new HTTPException(413, {
					message: "Files are limited to 50 MB",
				});
			},
		}),
	] as const,
	security: [{ bearerAuth: [] }],
	request: {
		body: {
			content: {
				"multipart/form-data": {
					schema: z.object({
						file: z.any().openapi({ type: "string", format: "binary" }),
						purpose: z.string().openapi({ example: "batch" }),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: { "application/json": { schema: fileObjectSchema } },
			description: "The uploaded file.",
		},
		...errorResponses,
	},
});

files.openapi(uploadFile, async (c): Promise<any> => {
	const { apiKey, project } = await requireBatchAccess(c);
	let form: Record<string, string | File>;
	try {
		form = await c.req.parseBody();
	} catch {
		invalidRequest("Invalid multipart form data");
	}
	if (form.purpose !== "batch") {
		invalidRequest("Only purpose=batch is supported");
	}
	const upload = form.file;
	if (!(upload instanceof File)) {
		invalidRequest("Missing file");
	}
	if (upload.size > BATCH_MAX_FILE_BYTES) {
		throw new HTTPException(413, { message: "Files are limited to 50 MB" });
	}
	await assertProjectStorageAvailable(project.id, upload.size);
	const content = await upload.text();
	const now = new Date();
	const [file] = await db
		.insert(tables.batchFile)
		.values({
			id: newBatchFileId(),
			organizationId: project.organizationId,
			projectId: project.id,
			apiKeyId: apiKey.id,
			purpose: "batch",
			filename: upload.name || "batch.jsonl",
			bytes: Buffer.byteLength(content),
			content,
			createdAt: now,
			expiresAt: new Date(now.getTime() + BATCH_FILE_TTL_MS),
		})
		.returning(fileColumns);
	return c.json(toFileObject(file));
});

const listFiles = createRoute({
	operationId: "v1_files_list",
	summary: "List files",
	method: "get",
	path: "/",
	security: [{ bearerAuth: [] }],
	request: {
		query: z.object({
			purpose: z.enum(["batch", "batch_output", "batch_error"]).optional(),
			limit: z.string().optional(),
			after: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: listSchema(fileObjectSchema) },
			},
			description: "Files of the API key's project, newest first.",
		},
		...errorResponses,
	},
});

files.openapi(listFiles, async (c): Promise<any> => {
	const { project } = await requireBatchAccess(c);
	const { purpose, after, limit: rawLimit } = c.req.valid("query");
	const limit = clampLimit(rawLimit, 100, 1000);
	const cursor = after
		? await db
				.select({
					id: tables.batchFile.id,
					createdAt: tables.batchFile.createdAt,
				})
				.from(tables.batchFile)
				.where(
					and(
						eq(tables.batchFile.id, after),
						eq(tables.batchFile.projectId, project.id),
					),
				)
				.then((rows) => rows[0])
		: undefined;
	const rows = await db
		.select(fileColumns)
		.from(tables.batchFile)
		.where(
			and(
				eq(tables.batchFile.projectId, project.id),
				purpose ? eq(tables.batchFile.purpose, purpose) : undefined,
				afterCursor(tables.batchFile, cursor),
			),
		)
		.orderBy(desc(tables.batchFile.createdAt), desc(tables.batchFile.id))
		.limit(limit + 1);
	return c.json(toList(rows.map(toFileObject), limit));
});

async function findFile(projectId: string, fileId: string) {
	const [file] = await db
		.select(fileColumns)
		.from(tables.batchFile)
		.where(
			and(
				eq(tables.batchFile.id, fileId),
				eq(tables.batchFile.projectId, projectId),
			),
		);
	return file ?? notFound("File", fileId);
}

const fileIdParams = z.object({ file_id: z.string() });

const retrieveFile = createRoute({
	operationId: "v1_files_retrieve",
	summary: "Retrieve file",
	method: "get",
	path: "/{file_id}",
	security: [{ bearerAuth: [] }],
	request: { params: fileIdParams },
	responses: {
		200: {
			content: { "application/json": { schema: fileObjectSchema } },
			description: "The file.",
		},
		...errorResponses,
	},
});

files.openapi(retrieveFile, async (c): Promise<any> => {
	const { project } = await requireBatchAccess(c);
	const { file_id: fileId } = c.req.valid("param");
	return c.json(toFileObject(await findFile(project.id, fileId)));
});

const deleteFile = createRoute({
	operationId: "v1_files_delete",
	summary: "Delete file",
	method: "delete",
	path: "/{file_id}",
	security: [{ bearerAuth: [] }],
	request: { params: fileIdParams },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						id: z.string(),
						object: z.literal("file"),
						deleted: z.boolean(),
					}),
				},
			},
			description: "The file was deleted.",
		},
		...errorResponses,
	},
});

files.openapi(deleteFile, async (c): Promise<any> => {
	const { project } = await requireBatchAccess(c);
	const { file_id: fileId } = c.req.valid("param");
	const file = await findFile(project.id, fileId);
	await db.delete(tables.batchFile).where(eq(tables.batchFile.id, file.id));
	// Output and error files are rendered from the request rows, which hold the
	// prompts and completions, so deleting a file deletes its rows.
	if (file.batchId && file.purpose !== "batch") {
		await deleteBatchRequests(
			file.batchId,
			file.purpose === "batch_output"
				? ["completed"]
				: ["failed", "cancelled", "expired"],
		);
	}
	return c.json({ id: file.id, object: "file", deleted: true });
});

const fileContent = createRoute({
	operationId: "v1_files_content",
	summary: "Retrieve file content",
	description:
		"Returns the JSONL content of an uploaded file, or the output or error file of a finished batch.",
	method: "get",
	path: "/{file_id}/content",
	security: [{ bearerAuth: [] }],
	request: { params: fileIdParams },
	responses: {
		200: {
			content: { "application/jsonl": { schema: z.string() } },
			description: "File content.",
		},
		...errorResponses,
	},
});

async function* outputLines(
	batchId: string,
	purpose: "batch_output" | "batch_error",
) {
	const statuses =
		purpose === "batch_output"
			? (["completed"] as const)
			: (["failed", "cancelled", "expired"] as const);
	let lastLine = 0;
	for (;;) {
		const rows = await db
			.select({
				id: tables.batchRequest.id,
				lineNumber: tables.batchRequest.lineNumber,
				customId: tables.batchRequest.customId,
				responseStatus: tables.batchRequest.responseStatus,
				responseBody: tables.batchRequest.responseBody,
				requestId: tables.batchRequest.requestId,
				error: tables.batchRequest.error,
			})
			.from(tables.batchRequest)
			.where(
				and(
					eq(tables.batchRequest.batchId, batchId),
					inArray(tables.batchRequest.status, [...statuses]),
					lastLine > 0
						? gt(tables.batchRequest.lineNumber, lastLine)
						: undefined,
				),
			)
			.orderBy(tables.batchRequest.lineNumber)
			.limit(OUTPUT_PAGE_SIZE);
		for (const row of rows) {
			yield buildBatchOutputLine({
				id: row.id,
				customId: row.customId,
				responseStatus: row.responseStatus,
				responseBody: row.responseBody,
				requestId: row.requestId,
				error: row.error
					? { code: row.error.code, message: row.error.message }
					: null,
			});
		}
		if (rows.length < OUTPUT_PAGE_SIZE) {
			return;
		}
		lastLine = rows[rows.length - 1].lineNumber;
	}
}

files.openapi(fileContent, async (c): Promise<any> => {
	const { project } = await requireBatchAccess(c);
	const { file_id: fileId } = c.req.valid("param");
	const file = await findFile(project.id, fileId);
	c.header("Content-Type", "application/jsonl");
	if (file.purpose === "batch") {
		const [row] = await db
			.select({ content: tables.batchFile.content })
			.from(tables.batchFile)
			.where(eq(tables.batchFile.id, file.id));
		return c.body(row?.content ?? "");
	}
	if (!file.batchId) {
		return c.body("");
	}
	const lines = outputLines(file.batchId, file.purpose);
	const encoder = new TextEncoder();
	return c.body(
		new ReadableStream<Uint8Array>({
			async pull(controller) {
				const next = await lines.next();
				if (next.done) {
					controller.close();
				} else {
					controller.enqueue(encoder.encode(next.value));
				}
			},
			async cancel() {
				await lines.return(undefined);
			},
		}),
	);
});

const createBatch = createRoute({
	operationId: "v1_batches_create",
	summary: "Create batch",
	description:
		"Creates a batch from an uploaded JSONL file. Requests run asynchronously within 24 hours through the normal gateway path, billed at standard rates.",
	method: "post",
	path: "/",
	security: [{ bearerAuth: [] }],
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						input_file_id: z.string(),
						endpoint: z.enum(BATCH_ENDPOINT_PATHS),
						completion_window: z.literal(BATCH_COMPLETION_WINDOW),
						metadata: z.record(z.string(), z.string()).nullable().optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: { "application/json": { schema: batchObjectSchema } },
			description: "The created batch.",
		},
		...errorResponses,
	},
});

function validateMetadata(metadata: Record<string, string> | null | undefined) {
	if (!metadata) {
		return null;
	}
	const entries = Object.entries(metadata);
	if (
		entries.length > MAX_METADATA_KEYS ||
		entries.some(
			([key, value]) =>
				key.length > MAX_METADATA_KEY_LENGTH ||
				value.length > MAX_METADATA_VALUE_LENGTH,
		)
	) {
		invalidRequest(
			`metadata holds at most ${MAX_METADATA_KEYS} keys of up to ${MAX_METADATA_KEY_LENGTH} characters with values of up to ${MAX_METADATA_VALUE_LENGTH}`,
		);
	}
	return metadata;
}

batches.openapi(createBatch, async (c): Promise<any> => {
	const { apiKey, project, clientIp } = await requireBatchAccess(c);
	const token = extractApiToken(c);
	const body = c.req.valid("json");
	const metadata = validateMetadata(body.metadata);
	const inputFile = await findFile(project.id, body.input_file_id);
	if (inputFile.purpose !== "batch") {
		invalidRequest("The input file must have purpose=batch");
	}
	const id = newBatchId();
	const now = new Date();
	const created = await db.transaction(async (tx) => {
		const [row] = await tx
			.insert(tables.batch)
			.values({
				id,
				organizationId: project.organizationId,
				projectId: project.id,
				apiKeyId: apiKey.id,
				endpoint: body.endpoint,
				inputFileId: inputFile.id,
				completionWindow: BATCH_COMPLETION_WINDOW,
				status: "validating",
				metadata,
				clientIp: clientIp ?? null,
				createdAt: now,
				expiresAt: new Date(now.getTime() + BATCH_COMPLETION_WINDOW_MS),
			})
			.returning();
		await tx.insert(tables.batchCredential).values({
			batchId: id,
			apiKeyId: apiKey.id,
			encryptedToken: encryptProviderKey(
				token,
				`batch:${id}`,
				project.organizationId,
			),
		});
		return row;
	});
	return c.json(toBatchObject(created));
});

const listBatches = createRoute({
	operationId: "v1_batches_list",
	summary: "List batches",
	method: "get",
	path: "/",
	security: [{ bearerAuth: [] }],
	request: {
		query: z.object({
			limit: z.string().optional(),
			after: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: listSchema(batchObjectSchema) },
			},
			description: "Batches of the API key's project, newest first.",
		},
		...errorResponses,
	},
});

batches.openapi(listBatches, async (c): Promise<any> => {
	const { project } = await requireBatchAccess(c);
	const { after, limit: rawLimit } = c.req.valid("query");
	const limit = clampLimit(rawLimit, 20, 100);
	const cursor = after
		? await db
				.select({ id: tables.batch.id, createdAt: tables.batch.createdAt })
				.from(tables.batch)
				.where(
					and(
						eq(tables.batch.id, after),
						eq(tables.batch.projectId, project.id),
					),
				)
				.then((rows) => rows[0])
		: undefined;
	const rows = await db
		.select()
		.from(tables.batch)
		.where(
			and(
				eq(tables.batch.projectId, project.id),
				afterCursor(tables.batch, cursor),
			),
		)
		.orderBy(desc(tables.batch.createdAt), desc(tables.batch.id))
		.limit(limit + 1);
	return c.json(toList((await withLiveCounts(rows)).map(toBatchObject), limit));
});

const LIVE_COUNT_STATUSES = new Set([
	"in_progress",
	"cancelling",
	"finalizing",
]);

/** Running batches report progress from their request rows. */
async function withLiveCounts(
	rows: InferSelectModel<typeof tables.batch>[],
): Promise<InferSelectModel<typeof tables.batch>[]> {
	const live = rows.filter((row) => LIVE_COUNT_STATUSES.has(row.status));
	if (live.length === 0) {
		return rows;
	}
	const counts = await db
		.select({
			batchId: tables.batchRequest.batchId,
			completed: sql<number>`count(*) filter (where ${tables.batchRequest.status} = 'completed')::int`,
			failed: sql<number>`count(*) filter (where ${tables.batchRequest.status} = 'failed')::int`,
		})
		.from(tables.batchRequest)
		.where(
			inArray(
				tables.batchRequest.batchId,
				live.map((row) => row.id),
			),
		)
		.groupBy(tables.batchRequest.batchId);
	const byId = new Map(counts.map((row) => [row.batchId, row]));
	return rows.map((row) => {
		const count = byId.get(row.id);
		return count && LIVE_COUNT_STATUSES.has(row.status)
			? {
					...row,
					requestCompleted: count.completed,
					requestFailed: count.failed,
				}
			: row;
	});
}

async function findBatch(projectId: string, batchId: string) {
	const [row] = await db
		.select()
		.from(tables.batch)
		.where(
			and(eq(tables.batch.id, batchId), eq(tables.batch.projectId, projectId)),
		);
	return row ?? notFound("Batch", batchId);
}

const batchIdParams = z.object({ batch_id: z.string() });

const retrieveBatch = createRoute({
	operationId: "v1_batches_retrieve",
	summary: "Retrieve batch",
	method: "get",
	path: "/{batch_id}",
	security: [{ bearerAuth: [] }],
	request: { params: batchIdParams },
	responses: {
		200: {
			content: { "application/json": { schema: batchObjectSchema } },
			description: "The batch.",
		},
		...errorResponses,
	},
});

batches.openapi(retrieveBatch, async (c): Promise<any> => {
	const { project } = await requireBatchAccess(c);
	const { batch_id: batchId } = c.req.valid("param");
	const [batch] = await withLiveCounts([await findBatch(project.id, batchId)]);
	return c.json(toBatchObject(batch));
});

const cancelBatch = createRoute({
	operationId: "v1_batches_cancel",
	summary: "Cancel batch",
	description:
		"Stops a batch. Requests already running finish; the rest are cancelled and reported in the error file.",
	method: "post",
	path: "/{batch_id}/cancel",
	security: [{ bearerAuth: [] }],
	request: { params: batchIdParams },
	responses: {
		200: {
			content: { "application/json": { schema: batchObjectSchema } },
			description: "The batch.",
		},
		...errorResponses,
	},
});

batches.openapi(cancelBatch, async (c): Promise<any> => {
	const { project } = await requireBatchAccess(c);
	const { batch_id: batchId } = c.req.valid("param");
	const existing = await findBatch(project.id, batchId);
	const [updated] = await db
		.update(tables.batch)
		.set({ status: "cancelling", cancellingAt: new Date() })
		.where(
			and(
				eq(tables.batch.id, existing.id),
				inArray(tables.batch.status, ["validating", "in_progress"]),
			),
		)
		.returning();
	if (updated) {
		return c.json(toBatchObject(updated));
	}
	const current = await findBatch(project.id, batchId);
	if (current.status === "cancelling" || current.status === "cancelled") {
		return c.json(toBatchObject(current));
	}
	throw new HTTPException(400, {
		message: `Batch ${batchId} is ${current.status} and cannot be cancelled`,
	});
});
