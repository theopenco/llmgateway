import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { userHasProjectAccess } from "@/utils/authorization.js";

import { logAuditEvent } from "@llmgateway/audit";
import {
	and,
	db,
	desc,
	drizzleCache,
	eq,
	getTableName,
	inArray,
	tables,
} from "@llmgateway/db";
import { canManageProject } from "@llmgateway/shared/organization-roles";
import {
	extractPromptVariables,
	PROMPT_LABEL_PATTERN,
	PROMPT_LATEST_LABEL,
	PROMPT_PRODUCTION_LABEL,
} from "@llmgateway/shared/prompt-template";

import type { ServerTypes } from "@/vars.js";

export const prompts = new OpenAPIHono<ServerTypes>();

const MAX_PROMPTS_PER_PROJECT = 500;
const MAX_LABELS_PER_VERSION_INPUT = 20;

/**
 * Writes go through the plain client, so evict the gateway's cached prompt
 * lookups (query cache and SWR mirror) explicitly once a mutation commits.
 */
async function invalidatePromptCache(): Promise<void> {
	await drizzleCache.onMutate({
		tables: [
			getTableName(tables.prompt),
			getTableName(tables.promptVersion),
			getTableName(tables.promptLabel),
		],
	});
}

const messageSchema = z.object({
	role: z.enum(["system", "user", "assistant", "developer"]),
	content: z.string().min(1).max(200_000),
});

const parametersSchema = z
	.object({
		temperature: z.number().min(0).max(2).optional(),
		top_p: z.number().min(0).max(1).optional(),
		max_tokens: z.number().int().min(1).max(1_000_000).optional(),
		frequency_penalty: z.number().min(-2).max(2).optional(),
		presence_penalty: z.number().min(-2).max(2).optional(),
		reasoning_effort: z
			.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"])
			.optional(),
	})
	.strict();

const labelSchema = z
	.string()
	.trim()
	.regex(
		PROMPT_LABEL_PATTERN,
		"Start with a letter; use letters, numbers, dots, dashes, and underscores",
	)
	.refine((label) => label !== PROMPT_LATEST_LABEL, {
		message: `'${PROMPT_LATEST_LABEL}' always means the newest version and cannot be assigned`,
	});

const versionInputSchema = z.object({
	messages: z.array(messageSchema).min(1).max(100),
	model: z.string().trim().min(1).max(256).nullable().optional(),
	parameters: parametersSchema.optional(),
	commitMessage: z.string().trim().max(500).nullable().optional(),
});

const promptLabelSchema = z.object({
	label: z.string(),
	version: z.number(),
	updatedAt: z.date(),
});

const promptSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	organizationId: z.string(),
	projectId: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	latestVersion: z.number(),
	labels: z.array(promptLabelSchema),
});

const promptVersionSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	promptId: z.string(),
	version: z.number(),
	messages: z.array(messageSchema),
	model: z.string().nullable(),
	parameters: parametersSchema.extend({
		reasoning_effort: z.string().optional(),
	}),
	variables: z.array(z.string()),
	commitMessage: z.string().nullable(),
	createdBy: z.string().nullable(),
});

const nameSchema = z
	.string()
	.trim()
	.min(1)
	.max(100)
	.regex(/^[\w.-]+$/, "Use letters, numbers, dots, dashes, and underscores");

const labelParamsSchema = z.object({ id: z.string(), label: labelSchema });

type PromptRow = typeof tables.prompt.$inferSelect;
type PromptLabelRow = typeof tables.promptLabel.$inferSelect;

function labelView(row: PromptLabelRow) {
	return { label: row.label, version: row.version, updatedAt: row.updatedAt };
}

/** Prompts with their labels, `production` first then alphabetical. */
async function withLabels<T extends PromptRow>(rows: T[]) {
	if (rows.length === 0) {
		return [];
	}
	const labelRows = await db
		.select()
		.from(tables.promptLabel)
		.where(
			inArray(
				tables.promptLabel.promptId,
				rows.map((row) => row.id),
			),
		);
	const byPrompt = new Map<string, PromptLabelRow[]>();
	for (const row of labelRows) {
		const list = byPrompt.get(row.promptId) ?? [];
		list.push(row);
		byPrompt.set(row.promptId, list);
	}
	return rows.map((row) => ({
		...row,
		labels: (byPrompt.get(row.id) ?? [])
			.sort((a, b) =>
				a.label === PROMPT_PRODUCTION_LABEL
					? -1
					: b.label === PROMPT_PRODUCTION_LABEL
						? 1
						: a.label.localeCompare(b.label),
			)
			.map(labelView),
	}));
}

async function promptWithLabels(row: PromptRow) {
	const [result] = await withLabels([row]);
	return result;
}

async function requireProjectAccess(
	userId: string,
	projectId: string,
	write: boolean,
) {
	const project = await db.query.project.findFirst({
		where: { id: { eq: projectId } },
	});
	if (!project || project.status === "deleted") {
		throw new HTTPException(404, { message: "Project not found" });
	}
	const userOrg = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: userId },
			organizationId: { eq: project.organizationId },
		},
	});
	if (!userOrg || !(await userHasProjectAccess(userId, projectId))) {
		throw new HTTPException(404, { message: "Project not found" });
	}
	if (write && !canManageProject(userOrg.role)) {
		throw new HTTPException(403, {
			message: "Only project admins can manage prompts",
		});
	}
	return project;
}

async function loadPrompt(userId: string, promptId: string, write: boolean) {
	const [row] = await db
		.select()
		.from(tables.prompt)
		.where(eq(tables.prompt.id, promptId))
		.limit(1);
	if (!row) {
		throw new HTTPException(404, { message: "Prompt not found" });
	}
	await requireProjectAccess(userId, row.projectId, write);
	return row;
}

function requireUser(user: { id: string } | null | undefined) {
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	return user;
}

function versionRow(input: z.infer<typeof versionInputSchema>) {
	return {
		messages: input.messages,
		model: input.model ?? null,
		parameters: input.parameters ?? {},
		variables: extractPromptVariables(input.messages),
		commitMessage: input.commitMessage ?? null,
	};
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Points `label` at `version`, creating or moving it. */
async function assignLabel(
	tx: Tx,
	promptId: string,
	label: string,
	version: number,
) {
	await tx
		.insert(tables.promptLabel)
		.values({ promptId, label, version })
		.onConflictDoUpdate({
			target: [tables.promptLabel.promptId, tables.promptLabel.label],
			set: { version, updatedAt: new Date() },
		});
}

const listPrompts = createRoute({
	method: "get",
	path: "/",
	request: { query: z.object({ projectId: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ prompts: z.array(promptSchema) }),
				},
			},
			description: "Prompts in the project.",
		},
	},
});

prompts.openapi(listPrompts, async (c) => {
	const user = requireUser(c.get("user"));
	const { projectId } = c.req.valid("query");
	await requireProjectAccess(user.id, projectId, false);
	const rows = await db
		.select()
		.from(tables.prompt)
		.where(eq(tables.prompt.projectId, projectId))
		.orderBy(desc(tables.prompt.updatedAt));
	return c.json({ prompts: await withLabels(rows) });
});

const createPrompt = createRoute({
	method: "post",
	path: "/",
	request: {
		body: {
			content: {
				"application/json": {
					schema: versionInputSchema.extend({
						projectId: z.string(),
						name: nameSchema,
						description: z.string().trim().max(1000).nullable().optional(),
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
						prompt: promptSchema,
						version: promptVersionSchema,
					}),
				},
			},
			description: "Created prompt with version 1 labelled production.",
		},
	},
});

prompts.openapi(createPrompt, async (c) => {
	const user = requireUser(c.get("user"));
	const body = c.req.valid("json");
	const project = await requireProjectAccess(user.id, body.projectId, true);
	const existing = await db
		.select({ id: tables.prompt.id, name: tables.prompt.name })
		.from(tables.prompt)
		.where(eq(tables.prompt.projectId, project.id));
	if (existing.some((row) => row.name === body.name)) {
		throw new HTTPException(409, {
			message: `A prompt named '${body.name}' already exists in this project`,
		});
	}
	if (existing.length >= MAX_PROMPTS_PER_PROJECT) {
		throw new HTTPException(400, {
			message: `Projects can hold at most ${MAX_PROMPTS_PER_PROJECT} prompts`,
		});
	}
	const result = await db.transaction(async (tx) => {
		const [prompt] = await tx
			.insert(tables.prompt)
			.values({
				organizationId: project.organizationId,
				projectId: project.id,
				name: body.name,
				description: body.description ?? null,
				latestVersion: 1,
			})
			.returning();
		const [version] = await tx
			.insert(tables.promptVersion)
			.values({
				promptId: prompt.id,
				version: 1,
				createdBy: user.id,
				...versionRow(body),
			})
			.returning();
		await assignLabel(tx, prompt.id, PROMPT_PRODUCTION_LABEL, 1);
		return { prompt, version };
	});
	await invalidatePromptCache();
	await logAuditEvent({
		organizationId: project.organizationId,
		userId: user.id,
		action: "prompt.create",
		resourceType: "prompt",
		resourceId: result.prompt.id,
		metadata: { resourceName: body.name, projectId: project.id },
	});
	return c.json({
		prompt: await promptWithLabels(result.prompt),
		version: result.version,
	});
});

const getPrompt = createRoute({
	method: "get",
	path: "/{id}",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						prompt: promptSchema,
						versions: z.array(promptVersionSchema),
					}),
				},
			},
			description: "Prompt with its labels and versions, newest first.",
		},
	},
});

prompts.openapi(getPrompt, async (c) => {
	const user = requireUser(c.get("user"));
	const prompt = await loadPrompt(user.id, c.req.valid("param").id, false);
	const versions = await db
		.select()
		.from(tables.promptVersion)
		.where(eq(tables.promptVersion.promptId, prompt.id))
		.orderBy(desc(tables.promptVersion.version));
	return c.json({ prompt: await promptWithLabels(prompt), versions });
});

const updatePrompt = createRoute({
	method: "patch",
	path: "/{id}",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						name: nameSchema.optional(),
						description: z.string().trim().max(1000).nullable().optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ prompt: promptSchema }) },
			},
			description: "Updated prompt.",
		},
	},
});

prompts.openapi(updatePrompt, async (c) => {
	const user = requireUser(c.get("user"));
	const existing = await loadPrompt(user.id, c.req.valid("param").id, true);
	const body = c.req.valid("json");
	if (body.name !== undefined && body.name !== existing.name) {
		const [clash] = await db
			.select({ id: tables.prompt.id })
			.from(tables.prompt)
			.where(
				and(
					eq(tables.prompt.projectId, existing.projectId),
					eq(tables.prompt.name, body.name),
				),
			)
			.limit(1);
		if (clash) {
			throw new HTTPException(409, {
				message: `A prompt named '${body.name}' already exists in this project`,
			});
		}
	}
	const [prompt] = await db
		.update(tables.prompt)
		.set({
			...(body.name !== undefined ? { name: body.name } : {}),
			...(body.description !== undefined
				? { description: body.description }
				: {}),
		})
		.where(eq(tables.prompt.id, existing.id))
		.returning();
	await invalidatePromptCache();
	await logAuditEvent({
		organizationId: existing.organizationId,
		userId: user.id,
		action: "prompt.update",
		resourceType: "prompt",
		resourceId: existing.id,
		metadata: { resourceName: prompt.name },
	});
	return c.json({ prompt: await promptWithLabels(prompt) });
});

const createVersion = createRoute({
	method: "post",
	path: "/{id}/versions",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: versionInputSchema.extend({
						labels: z
							.array(labelSchema)
							.max(MAX_LABELS_PER_VERSION_INPUT)
							.optional()
							.openapi({
								description:
									"Labels to point at the new version, e.g. ['production'] to deploy it right away.",
							}),
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
						prompt: promptSchema,
						version: promptVersionSchema,
					}),
				},
			},
			description: "New immutable version.",
		},
	},
});

prompts.openapi(createVersion, async (c) => {
	const user = requireUser(c.get("user"));
	const existing = await loadPrompt(user.id, c.req.valid("param").id, true);
	const body = c.req.valid("json");
	const labels = [...new Set(body.labels ?? [])];
	const result = await db.transaction(async (tx) => {
		const [locked] = await tx
			.select({ latestVersion: tables.prompt.latestVersion })
			.from(tables.prompt)
			.where(eq(tables.prompt.id, existing.id))
			.for("update");
		const next = locked.latestVersion + 1;
		const [version] = await tx
			.insert(tables.promptVersion)
			.values({
				promptId: existing.id,
				version: next,
				createdBy: user.id,
				...versionRow(body),
			})
			.returning();
		const [prompt] = await tx
			.update(tables.prompt)
			.set({ latestVersion: next })
			.where(eq(tables.prompt.id, existing.id))
			.returning();
		for (const label of labels) {
			await assignLabel(tx, existing.id, label, next);
		}
		return { prompt, version };
	});
	await invalidatePromptCache();
	await logAuditEvent({
		organizationId: existing.organizationId,
		userId: user.id,
		action: "prompt.version_create",
		resourceType: "prompt",
		resourceId: existing.id,
		metadata: {
			resourceName: existing.name,
			version: result.version.version,
			labels,
		},
	});
	return c.json({
		prompt: await promptWithLabels(result.prompt),
		version: result.version,
	});
});

const setLabel = createRoute({
	method: "put",
	path: "/{id}/labels/{label}",
	request: {
		params: labelParamsSchema,
		body: {
			content: {
				"application/json": {
					schema: z.object({ version: z.number().int().min(1) }),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ prompt: promptSchema }) },
			},
			description:
				"Prompt after pointing the label at the version. Deploying is `production` → version.",
		},
	},
});

prompts.openapi(setLabel, async (c) => {
	const user = requireUser(c.get("user"));
	const { id, label } = c.req.valid("param");
	const existing = await loadPrompt(user.id, id, true);
	const { version } = c.req.valid("json");
	const [found] = await db
		.select({ id: tables.promptVersion.id })
		.from(tables.promptVersion)
		.where(
			and(
				eq(tables.promptVersion.promptId, existing.id),
				eq(tables.promptVersion.version, version),
			),
		)
		.limit(1);
	if (!found) {
		throw new HTTPException(404, { message: `Version ${version} not found` });
	}
	const [previous] = await db
		.select({ version: tables.promptLabel.version })
		.from(tables.promptLabel)
		.where(
			and(
				eq(tables.promptLabel.promptId, existing.id),
				eq(tables.promptLabel.label, label),
			),
		)
		.limit(1);
	await db.transaction((tx) => assignLabel(tx, existing.id, label, version));
	await invalidatePromptCache();
	await logAuditEvent({
		organizationId: existing.organizationId,
		userId: user.id,
		action: "prompt.deploy",
		resourceType: "prompt",
		resourceId: existing.id,
		metadata: {
			resourceName: existing.name,
			label,
			changes: { version: { old: previous?.version ?? null, new: version } },
		},
	});
	return c.json({ prompt: await promptWithLabels(existing) });
});

const deleteLabel = createRoute({
	method: "delete",
	path: "/{id}/labels/{label}",
	request: { params: labelParamsSchema },
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ prompt: promptSchema }) },
			},
			description:
				"Prompt without the label. `production` cannot be removed, only moved.",
		},
	},
});

prompts.openapi(deleteLabel, async (c) => {
	const user = requireUser(c.get("user"));
	const { id, label } = c.req.valid("param");
	if (label === PROMPT_PRODUCTION_LABEL) {
		throw new HTTPException(400, {
			message:
				"The production label serves every request that names no label; point it at another version instead of removing it",
		});
	}
	const existing = await loadPrompt(user.id, id, true);
	const removed = await db
		.delete(tables.promptLabel)
		.where(
			and(
				eq(tables.promptLabel.promptId, existing.id),
				eq(tables.promptLabel.label, label),
			),
		)
		.returning({ version: tables.promptLabel.version });
	if (removed.length === 0) {
		throw new HTTPException(404, { message: `Label '${label}' not found` });
	}
	await invalidatePromptCache();
	await logAuditEvent({
		organizationId: existing.organizationId,
		userId: user.id,
		action: "prompt.label_delete",
		resourceType: "prompt",
		resourceId: existing.id,
		metadata: {
			resourceName: existing.name,
			label,
			changes: { version: { old: removed[0].version, new: null } },
		},
	});
	return c.json({ prompt: await promptWithLabels(existing) });
});

const deletePrompt = createRoute({
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

prompts.openapi(deletePrompt, async (c) => {
	const user = requireUser(c.get("user"));
	const existing = await loadPrompt(user.id, c.req.valid("param").id, true);
	await db.delete(tables.prompt).where(eq(tables.prompt.id, existing.id));
	await invalidatePromptCache();
	await logAuditEvent({
		organizationId: existing.organizationId,
		userId: user.id,
		action: "prompt.delete",
		resourceType: "prompt",
		resourceId: existing.id,
		metadata: { resourceName: existing.name },
	});
	return c.json({ success: true });
});
