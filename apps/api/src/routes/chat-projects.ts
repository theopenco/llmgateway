import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { generateText, tool } from "ai";
import { HTTPException } from "hono/http-exception";

import { extractFileText } from "@/lib/file-extract.js";
import { chunkText, cosineSimilarity, embedTexts } from "@/lib/rag.js";
import { buildOrgHistoryFilter } from "@/utils/org-history-filter.js";
import {
	getGatewayUrl,
	resolvePlaygroundToken,
} from "@/utils/playground-key.js";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";
import { db, tables, eq, and, count, desc, asc } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const chatProjects = new OpenAPIHono<ServerTypes>();

const MAX_FILES_PER_PROJECT = 20;
const MAX_FILE_CONTENT_CHARS = 500_000;
// Base64 payload cap for binary uploads (~10 MB of file data).
const MAX_UPLOAD_BASE64_CHARS = 14_000_000;
const DEFAULT_TOP_K = 6;
const MAX_TOP_K = 20;
// Chunks scoring below this cosine similarity are never returned; unrelated
// text pairs typically land well under this with text-embedding-3-small.
const MIN_RETRIEVAL_SCORE = 0.1;

const MAX_MEMORIES_PER_PROJECT = 50;
const MAX_MEMORY_CHARS = 1000;
// Model used to extract durable memories from chat exchanges; must support
// tool calling.
const MEMORY_EXTRACTION_MODEL = "openai/gpt-5-mini";
const MEMORY_EXTRACTION_TIMEOUT_MS = 60_000;

const chatProjectSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	instructions: z.string(),
	organizationId: z.string().nullable(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
	fileCount: z.number(),
	chatCount: z.number(),
});

const projectFileSchema = z.object({
	id: z.string(),
	name: z.string(),
	mimeType: z.string(),
	size: z.number(),
	status: z.enum(["processing", "ready", "error"]),
	error: z.string().nullable(),
	chunkCount: z.number(),
	createdAt: z.string().datetime(),
});

const createProjectSchema = z.object({
	name: z.string().trim().min(1).max(100),
	description: z.string().max(2000).optional().default(""),
	instructions: z.string().max(20_000).optional().default(""),
	organizationId: z.string().trim().min(1).optional(),
});

const updateProjectSchema = z.object({
	name: z.string().trim().min(1).max(100).optional(),
	description: z.string().max(2000).optional(),
	instructions: z.string().max(20_000).optional(),
});

const uploadFileSchema = z
	.object({
		name: z.string().trim().min(1).max(255),
		mimeType: z.string().trim().min(1).max(255),
		// Plain text content, for text-based files read client-side.
		content: z.string().min(1).max(MAX_FILE_CONTENT_CHARS).optional(),
		// Raw file bytes for binary formats (PDF, Excel); text is extracted
		// server-side.
		contentBase64: z.string().min(1).max(MAX_UPLOAD_BASE64_CHARS).optional(),
	})
	.refine(
		(data) =>
			(data.content !== undefined) !== (data.contentBase64 !== undefined),
		{ message: "Provide exactly one of content or contentBase64" },
	);

const memorySchema = z.object({
	id: z.string(),
	content: z.string(),
	source: z.enum(["manual", "auto"]),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

const createMemorySchema = z.object({
	content: z.string().trim().min(1).max(MAX_MEMORY_CHARS),
});

const extractMemoriesSchema = z.object({
	userMessage: z.string().trim().min(1).max(8000),
	assistantMessage: z.string().trim().min(1).max(8000),
});

const retrieveSchema = z.object({
	query: z.string().trim().min(1).max(10_000),
	topK: z.number().int().min(1).max(MAX_TOP_K).optional(),
});

function formatProject(
	project: {
		id: string;
		name: string;
		description: string;
		instructions: string;
		organizationId: string | null;
		createdAt: Date;
		updatedAt: Date;
	},
	fileCount: number,
	chatCount: number,
) {
	return {
		id: project.id,
		name: project.name,
		description: project.description,
		instructions: project.instructions,
		organizationId: project.organizationId,
		createdAt: project.createdAt.toISOString(),
		updatedAt: project.updatedAt.toISOString(),
		fileCount,
		chatCount,
	};
}

function formatFile(file: {
	id: string;
	name: string;
	mimeType: string;
	size: number;
	status: string;
	error: string | null;
	chunkCount: number;
	createdAt: Date;
}) {
	return {
		id: file.id,
		name: file.name,
		mimeType: file.mimeType,
		size: file.size,
		status: file.status as "processing" | "ready" | "error",
		error: file.error,
		chunkCount: file.chunkCount,
		createdAt: file.createdAt.toISOString(),
	};
}

async function getOwnedProject(projectId: string, userId: string) {
	const project = await db.query.chatProject.findFirst({
		where: { id: { eq: projectId } },
	});
	if (!project) {
		throw new HTTPException(404, { message: "Project not found" });
	}
	if (project.userId !== userId) {
		throw new HTTPException(403, { message: "Forbidden" });
	}
	return project;
}

// List user's chat projects
const listProjects = createRoute({
	method: "get",
	path: "/",
	request: {
		query: z.object({
			organizationId: z.string().trim().min(1).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						projects: z.array(chatProjectSchema),
					}),
				},
			},
			description: "List of user's chat projects",
		},
	},
});

chatProjects.openapi(listProjects, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId } = c.req.valid("query");
	const orgFilter = await buildOrgHistoryFilter(
		tables.chatProject.organizationId,
		organizationId,
	);

	const rows = await db
		.select({
			id: tables.chatProject.id,
			name: tables.chatProject.name,
			description: tables.chatProject.description,
			instructions: tables.chatProject.instructions,
			organizationId: tables.chatProject.organizationId,
			createdAt: tables.chatProject.createdAt,
			updatedAt: tables.chatProject.updatedAt,
			fileCount: count(tables.chatProjectFile.id),
		})
		.from(tables.chatProject)
		.leftJoin(
			tables.chatProjectFile,
			eq(tables.chatProject.id, tables.chatProjectFile.projectId),
		)
		.where(and(eq(tables.chatProject.userId, user.id), orgFilter))
		.groupBy(tables.chatProject.id)
		.orderBy(desc(tables.chatProject.updatedAt));

	// Chat counts in one query rather than per project.
	const chatCounts = rows.length
		? await db
				.select({
					projectId: tables.chat.projectId,
					chatCount: count(tables.chat.id),
				})
				.from(tables.chat)
				.where(
					and(
						eq(tables.chat.userId, user.id),
						eq(tables.chat.status, "active"),
					),
				)
				.groupBy(tables.chat.projectId)
		: [];
	const chatCountByProject = new Map(
		chatCounts.map((row) => [row.projectId, row.chatCount]),
	);

	return c.json({
		projects: rows.map((row) =>
			formatProject(row, row.fileCount, chatCountByProject.get(row.id) ?? 0),
		),
	});
});

// Create chat project
const createProject = createRoute({
	method: "post",
	path: "/",
	request: {
		body: {
			content: {
				"application/json": {
					schema: createProjectSchema,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ project: chatProjectSchema }),
				},
			},
			description: "Created chat project",
		},
	},
});

chatProjects.openapi(createProject, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const body = c.req.valid("json");

	const [created] = await db
		.insert(tables.chatProject)
		.values({
			name: body.name,
			description: body.description ?? "",
			instructions: body.instructions ?? "",
			userId: user.id,
			organizationId: body.organizationId ?? null,
		})
		.returning();

	return c.json({ project: formatProject(created, 0, 0) }, 201);
});

// Get chat project with files
const getProject = createRoute({
	method: "get",
	path: "/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						project: chatProjectSchema,
						files: z.array(projectFileSchema),
					}),
				},
			},
			description: "Chat project with its knowledge base files",
		},
	},
});

chatProjects.openapi(getProject, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");
	const project = await getOwnedProject(id, user.id);

	const [files, [chatCount]] = await Promise.all([
		db.query.chatProjectFile.findMany({
			where: { projectId: { eq: id } },
			orderBy: (t, { desc: sortDesc }) => [sortDesc(t.createdAt)],
		}),
		db
			.select({ count: count() })
			.from(tables.chat)
			.where(
				and(
					eq(tables.chat.projectId, id),
					eq(tables.chat.userId, user.id),
					eq(tables.chat.status, "active"),
				),
			),
	]);

	return c.json({
		project: formatProject(project, files.length, chatCount.count),
		files: files.map(formatFile),
	});
});

// Update chat project
const updateProject = createRoute({
	method: "patch",
	path: "/{id}",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: updateProjectSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ project: chatProjectSchema }),
				},
			},
			description: "Updated chat project",
		},
	},
});

chatProjects.openapi(updateProject, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");
	const body = c.req.valid("json");
	await getOwnedProject(id, user.id);

	const [updated] = await db
		.update(tables.chatProject)
		.set({
			...(body.name !== undefined ? { name: body.name } : {}),
			...(body.description !== undefined
				? { description: body.description }
				: {}),
			...(body.instructions !== undefined
				? { instructions: body.instructions }
				: {}),
		})
		.where(
			and(
				eq(tables.chatProject.id, id),
				eq(tables.chatProject.userId, user.id),
			),
		)
		.returning();

	const [[fileCount], [chatCount]] = await Promise.all([
		db
			.select({ count: count() })
			.from(tables.chatProjectFile)
			.where(eq(tables.chatProjectFile.projectId, id)),
		db
			.select({ count: count() })
			.from(tables.chat)
			.where(
				and(
					eq(tables.chat.projectId, id),
					eq(tables.chat.userId, user.id),
					eq(tables.chat.status, "active"),
				),
			),
	]);

	return c.json({
		project: formatProject(updated, fileCount.count, chatCount.count),
	});
});

// Delete chat project
const deleteProject = createRoute({
	method: "delete",
	path: "/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ success: z.boolean() }),
				},
			},
			description: "Chat project deleted",
		},
	},
});

chatProjects.openapi(deleteProject, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");
	await getOwnedProject(id, user.id);

	await db
		.delete(tables.chatProject)
		.where(
			and(
				eq(tables.chatProject.id, id),
				eq(tables.chatProject.userId, user.id),
			),
		);

	return c.json({ success: true });
});

// Upload a knowledge base file: chunk, embed via the gateway, and store.
const uploadFile = createRoute({
	method: "post",
	path: "/{id}/files",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: uploadFileSchema,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ file: projectFileSchema }),
				},
			},
			description: "Uploaded and indexed knowledge base file",
		},
	},
});

chatProjects.openapi(uploadFile, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");
	const body = c.req.valid("json");
	await getOwnedProject(id, user.id);

	const [existingFiles] = await db
		.select({ count: count() })
		.from(tables.chatProjectFile)
		.where(eq(tables.chatProjectFile.projectId, id));
	if (existingFiles.count >= MAX_FILES_PER_PROJECT) {
		throw new HTTPException(400, {
			message: `Projects can hold at most ${MAX_FILES_PER_PROJECT} files`,
		});
	}

	let textContent: string;
	let fileSize: number;
	if (body.contentBase64 !== undefined) {
		const buffer = Buffer.from(body.contentBase64, "base64");
		fileSize = buffer.length;
		try {
			textContent = await extractFileText(body.name, body.mimeType, buffer);
		} catch {
			throw new HTTPException(400, {
				message: `Could not extract text from ${body.name}`,
			});
		}
		if (textContent.length > MAX_FILE_CONTENT_CHARS) {
			throw new HTTPException(400, {
				message: `${body.name} has too much text to index (max ${MAX_FILE_CONTENT_CHARS} characters)`,
			});
		}
	} else {
		textContent = body.content!;
		fileSize = Buffer.byteLength(textContent, "utf8");
	}

	const chunks = chunkText(textContent);
	if (!chunks.length) {
		throw new HTTPException(400, {
			message: "The file has no extractable text content",
		});
	}

	const [file] = await db
		.insert(tables.chatProjectFile)
		.values({
			projectId: id,
			name: body.name,
			mimeType: body.mimeType,
			size: fileSize,
			content: textContent,
			status: "processing",
		})
		.returning();

	try {
		const token = await resolvePlaygroundToken(c, user);
		const embeddings = await embedTexts(token, chunks);

		await db.insert(tables.chatProjectFileChunk).values(
			chunks.map((content, index) => ({
				fileId: file.id,
				projectId: id,
				chunkIndex: index,
				content,
				embedding: embeddings[index],
			})),
		);

		const [ready] = await db
			.update(tables.chatProjectFile)
			.set({ status: "ready", chunkCount: chunks.length, error: null })
			.where(eq(tables.chatProjectFile.id, file.id))
			.returning();

		return c.json({ file: formatFile(ready) }, 201);
	} catch (error) {
		const message =
			error instanceof HTTPException
				? error.message
				: "Failed to index the file";
		await db
			.update(tables.chatProjectFile)
			.set({ status: "error", error: message })
			.where(eq(tables.chatProjectFile.id, file.id));
		throw error instanceof HTTPException
			? error
			: new HTTPException(502, { message });
	}
});

// Delete a knowledge base file (chunks cascade)
const deleteFile = createRoute({
	method: "delete",
	path: "/{id}/files/{fileId}",
	request: {
		params: z.object({ id: z.string(), fileId: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ success: z.boolean() }),
				},
			},
			description: "Knowledge base file deleted",
		},
	},
});

chatProjects.openapi(deleteFile, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id, fileId } = c.req.valid("param");
	await getOwnedProject(id, user.id);

	const file = await db.query.chatProjectFile.findFirst({
		where: { id: { eq: fileId }, projectId: { eq: id } },
	});
	if (!file) {
		throw new HTTPException(404, { message: "File not found" });
	}

	await db
		.delete(tables.chatProjectFile)
		.where(eq(tables.chatProjectFile.id, fileId));

	return c.json({ success: true });
});

// Retrieve the most relevant knowledge base chunks for a query. Used by the
// playground chat route to ground responses in the project's files.
const retrieve = createRoute({
	method: "post",
	path: "/{id}/retrieve",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: retrieveSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						project: z.object({
							id: z.string(),
							name: z.string(),
							instructions: z.string(),
						}),
						chunks: z.array(
							z.object({
								content: z.string(),
								score: z.number(),
								fileId: z.string(),
								fileName: z.string(),
							}),
						),
						memories: z.array(z.string()),
					}),
				},
			},
			description: "Most relevant knowledge base chunks for the query",
		},
	},
});

chatProjects.openapi(retrieve, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");
	const { query, topK } = c.req.valid("json");
	const project = await getOwnedProject(id, user.id);

	const projectInfo = {
		id: project.id,
		name: project.name,
		instructions: project.instructions,
	};

	const [chunks, memoryRows] = await Promise.all([
		db
			.select({
				content: tables.chatProjectFileChunk.content,
				embedding: tables.chatProjectFileChunk.embedding,
				fileId: tables.chatProjectFileChunk.fileId,
				fileName: tables.chatProjectFile.name,
			})
			.from(tables.chatProjectFileChunk)
			.innerJoin(
				tables.chatProjectFile,
				eq(tables.chatProjectFileChunk.fileId, tables.chatProjectFile.id),
			)
			.where(
				and(
					eq(tables.chatProjectFileChunk.projectId, id),
					eq(tables.chatProjectFile.status, "ready"),
				),
			),
		db
			.select({ content: tables.chatProjectMemory.content })
			.from(tables.chatProjectMemory)
			.where(eq(tables.chatProjectMemory.projectId, id))
			.orderBy(asc(tables.chatProjectMemory.createdAt)),
	]);
	const memories = memoryRows.map((row) => row.content);

	if (!chunks.length) {
		return c.json({ project: projectInfo, chunks: [], memories });
	}

	// Server-to-server callers (the playground chat route) pass the same
	// gateway key the chat request uses, so retrieval bills the same org.
	const headerKey = c.req.header("x-llmgateway-key");
	const token = headerKey ?? (await resolvePlaygroundToken(c, user));
	const [queryEmbedding] = await embedTexts(token, [query]);

	const scored = chunks
		.map((chunk) => ({
			content: chunk.content,
			fileId: chunk.fileId,
			fileName: chunk.fileName,
			score: cosineSimilarity(queryEmbedding, chunk.embedding),
		}))
		.filter((chunk) => chunk.score >= MIN_RETRIEVAL_SCORE)
		.sort((a, b) => b.score - a.score)
		.slice(0, topK ?? DEFAULT_TOP_K);

	return c.json({ project: projectInfo, chunks: scored, memories });
});

function formatMemory(memory: {
	id: string;
	content: string;
	source: string;
	createdAt: Date;
	updatedAt: Date;
}) {
	return {
		id: memory.id,
		content: memory.content,
		source: memory.source as "manual" | "auto",
		createdAt: memory.createdAt.toISOString(),
		updatedAt: memory.updatedAt.toISOString(),
	};
}

// List a project's memories
const listMemories = createRoute({
	method: "get",
	path: "/{id}/memories",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ memories: z.array(memorySchema) }),
				},
			},
			description: "Project memories, oldest first",
		},
	},
});

chatProjects.openapi(listMemories, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");
	await getOwnedProject(id, user.id);

	const rows = await db.query.chatProjectMemory.findMany({
		where: { projectId: { eq: id } },
		orderBy: (t, { asc: sortAsc }) => [sortAsc(t.createdAt)],
	});

	return c.json({ memories: rows.map(formatMemory) });
});

// Add a memory manually
const createMemory = createRoute({
	method: "post",
	path: "/{id}/memories",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: createMemorySchema,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ memory: memorySchema }),
				},
			},
			description: "Created memory",
		},
	},
});

chatProjects.openapi(createMemory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");
	const body = c.req.valid("json");
	await getOwnedProject(id, user.id);

	const [existing] = await db
		.select({ count: count() })
		.from(tables.chatProjectMemory)
		.where(eq(tables.chatProjectMemory.projectId, id));
	if (existing.count >= MAX_MEMORIES_PER_PROJECT) {
		throw new HTTPException(400, {
			message: `Projects can hold at most ${MAX_MEMORIES_PER_PROJECT} memories`,
		});
	}

	const [created] = await db
		.insert(tables.chatProjectMemory)
		.values({
			projectId: id,
			content: body.content,
			source: "manual",
		})
		.returning();

	return c.json({ memory: formatMemory(created) }, 201);
});

// Edit a memory
const updateMemory = createRoute({
	method: "patch",
	path: "/{id}/memories/{memoryId}",
	request: {
		params: z.object({ id: z.string(), memoryId: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: createMemorySchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ memory: memorySchema }),
				},
			},
			description: "Updated memory",
		},
	},
});

chatProjects.openapi(updateMemory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id, memoryId } = c.req.valid("param");
	const body = c.req.valid("json");
	await getOwnedProject(id, user.id);

	const [updated] = await db
		.update(tables.chatProjectMemory)
		.set({ content: body.content })
		.where(
			and(
				eq(tables.chatProjectMemory.id, memoryId),
				eq(tables.chatProjectMemory.projectId, id),
			),
		)
		.returning();

	if (!updated) {
		throw new HTTPException(404, { message: "Memory not found" });
	}

	return c.json({ memory: formatMemory(updated) });
});

// Delete a memory
const deleteMemory = createRoute({
	method: "delete",
	path: "/{id}/memories/{memoryId}",
	request: {
		params: z.object({ id: z.string(), memoryId: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ success: z.boolean() }),
				},
			},
			description: "Memory deleted",
		},
	},
});

chatProjects.openapi(deleteMemory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id, memoryId } = c.req.valid("param");
	await getOwnedProject(id, user.id);

	const deleted = await db
		.delete(tables.chatProjectMemory)
		.where(
			and(
				eq(tables.chatProjectMemory.id, memoryId),
				eq(tables.chatProjectMemory.projectId, id),
			),
		)
		.returning();

	if (!deleted.length) {
		throw new HTTPException(404, { message: "Memory not found" });
	}

	return c.json({ success: true });
});

const extractedMemoriesSchema = z.object({
	memories: z
		.array(z.string().trim().min(1).max(MAX_MEMORY_CHARS))
		.max(3)
		.describe(
			"Zero to three short, self-contained facts worth remembering across future chats in this project. Pass an empty array when the exchange contains nothing durable.",
		),
});

const MEMORY_EXTRACTOR_SYSTEM = `You maintain the long-term memory of a chat project. Given one user/assistant exchange and the list of facts already remembered, extract only NEW durable facts worth carrying into future conversations: stable user preferences ("prefers concise answers"), lasting facts about people, projects, or constraints. Do NOT save one-off questions, information already covered by an existing memory, anything taken from the project's knowledge base files, or transient conversation details. Each memory must be one short self-contained sentence.

Always call save_memories exactly once — with an empty array if nothing qualifies.`;

// Extract durable memories from a chat exchange. Called fire-and-forget by
// the playground chat route after an assistant response in a project chat.
const extractMemories = createRoute({
	method: "post",
	path: "/{id}/memories/extract",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: extractMemoriesSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ memories: z.array(memorySchema) }),
				},
			},
			description: "Newly saved memories (may be empty)",
		},
	},
});

chatProjects.openapi(extractMemories, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");
	const body = c.req.valid("json");
	await getOwnedProject(id, user.id);

	const existing = await db.query.chatProjectMemory.findMany({
		where: { projectId: { eq: id } },
		orderBy: (t, { asc: sortAsc }) => [sortAsc(t.createdAt)],
	});
	if (existing.length >= MAX_MEMORIES_PER_PROJECT) {
		return c.json({ memories: [] });
	}

	const headerKey = c.req.header("x-llmgateway-key");
	const token = headerKey ?? (await resolvePlaygroundToken(c, user));

	const llmgateway = createLLMGateway({
		apiKey: token,
		baseURL: getGatewayUrl(),
		headers: {
			"x-source": "chat.llmgateway.io",
		},
	});

	const existingList = existing.length
		? existing.map((m) => `- ${m.content}`).join("\n")
		: "(none)";

	const result = await generateText({
		model: llmgateway.chat(MEMORY_EXTRACTION_MODEL),
		system: MEMORY_EXTRACTOR_SYSTEM,
		prompt: `Existing memories:\n${existingList}\n\nUser message:\n${body.userMessage}\n\nAssistant response:\n${body.assistantMessage}`,
		tools: {
			save_memories: tool({
				description: "Save the new durable memories from this exchange.",
				inputSchema: extractedMemoriesSchema,
			}),
		},
		toolChoice: "required",
		abortSignal: AbortSignal.timeout(MEMORY_EXTRACTION_TIMEOUT_MS),
	});

	const saveCall = result.toolCalls.find(
		(call) => call.toolName === "save_memories",
	);
	const parsed = extractedMemoriesSchema.safeParse(saveCall?.input);
	if (!parsed.success || !parsed.data.memories.length) {
		return c.json({ memories: [] });
	}

	const room = MAX_MEMORIES_PER_PROJECT - existing.length;
	// Dedupe against saved memories AND within the extraction batch itself.
	const seenContents = new Set(
		existing.map((m) => m.content.trim().toLowerCase()),
	);
	const fresh: string[] = [];
	for (const memory of parsed.data.memories) {
		const normalized = memory.trim().toLowerCase();
		if (seenContents.has(normalized)) {
			continue;
		}
		seenContents.add(normalized);
		fresh.push(memory);
		if (fresh.length >= room) {
			break;
		}
	}
	if (!fresh.length) {
		return c.json({ memories: [] });
	}

	const created = await db
		.insert(tables.chatProjectMemory)
		.values(
			fresh.map((content) => ({
				projectId: id,
				content,
				source: "auto" as const,
			})),
		)
		.returning();

	return c.json({ memories: created.map(formatMemory) });
});
