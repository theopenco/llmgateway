import { OpenAPIHono, z } from "@hono/zod-openapi";
import { generateText, tool } from "ai";
import { HTTPException } from "hono/http-exception";

import { createRoute } from "@/utils/create-route.js";
import {
	getGatewayUrl,
	resolvePlaygroundToken,
} from "@/utils/playground-key.js";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";
import { db, tables, eq, and } from "@llmgateway/db";
import { deferDownloadsToGateway } from "@llmgateway/shared/ai-sdk-download";
import { forwardedIpHeaders } from "@llmgateway/shared/client-ip";
import { LOUNGE_SOURCE } from "@llmgateway/shared/lounge-source";

import type { ServerTypes } from "@/vars.js";

export const skills = new OpenAPIHono<ServerTypes>();

const skillSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	instructions: z.string(),
	enabled: z.boolean(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

function serializeSkill(s: typeof tables.skill.$inferSelect) {
	return {
		id: s.id,
		name: s.name,
		description: s.description,
		instructions: s.instructions,
		enabled: s.enabled,
		createdAt: s.createdAt.toISOString(),
		updatedAt: s.updatedAt.toISOString(),
	};
}

const createSkillSchema = z.object({
	name: z.string().min(1).max(100),
	description: z.string().max(2000),
	instructions: z.string().min(1),
	enabled: z.boolean().optional().default(true),
});

const updateSkillSchema = z.object({
	name: z.string().min(1).max(100).optional(),
	description: z.string().max(2000).optional(),
	instructions: z.string().min(1).optional(),
	enabled: z.boolean().optional(),
});

const listSkills = createRoute({
	method: "get",
	path: "/",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						skills: z.array(skillSchema),
					}),
				},
			},
			description: "List of user's skills",
		},
	},
});

skills.openapi(listSkills, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const rows = await db.query.skill.findMany({
		where: { userId: { eq: user.id } },
		orderBy: (t, { desc }) => [desc(t.createdAt)],
	});

	return c.json({
		skills: rows.map(serializeSkill),
	});
});

const createSkill = createRoute({
	method: "post",
	path: "/",
	request: {
		body: {
			content: {
				"application/json": {
					schema: createSkillSchema,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ skill: skillSchema }),
				},
			},
			description: "Created skill",
		},
	},
});

skills.openapi(createSkill, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const body = c.req.valid("json");

	const [created] = await db
		.insert(tables.skill)
		.values({
			userId: user.id,
			name: body.name,
			description: body.description,
			instructions: body.instructions,
			enabled: body.enabled ?? true,
		})
		.returning();

	return c.json({ skill: serializeSkill(created) }, 201);
});

const getSkill = createRoute({
	method: "get",
	path: "/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ skill: skillSchema }),
				},
			},
			description: "Skill details",
		},
	},
});

skills.openapi(getSkill, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");

	const s = await db.query.skill.findFirst({
		where: { id: { eq: id } },
	});

	if (!s) {
		throw new HTTPException(404, { message: "Skill not found" });
	}

	if (s.userId !== user.id) {
		throw new HTTPException(403, { message: "Forbidden" });
	}

	return c.json({ skill: serializeSkill(s) });
});

const updateSkill = createRoute({
	method: "patch",
	path: "/{id}",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: updateSkillSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ skill: skillSchema }),
				},
			},
			description: "Updated skill",
		},
	},
});

skills.openapi(updateSkill, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");
	const body = c.req.valid("json");

	const [updated] = await db
		.update(tables.skill)
		.set({
			...(body.name !== undefined ? { name: body.name } : {}),
			...(body.description !== undefined
				? { description: body.description }
				: {}),
			...(body.instructions !== undefined
				? { instructions: body.instructions }
				: {}),
			...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
		})
		.where(and(eq(tables.skill.id, id), eq(tables.skill.userId, user.id)))
		.returning();

	if (!updated) {
		throw new HTTPException(404, { message: "Skill not found" });
	}

	return c.json({ skill: serializeSkill(updated) });
});

const deleteSkill = createRoute({
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
			description: "Skill deleted",
		},
	},
});

skills.openapi(deleteSkill, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");

	const [deleted] = await db
		.delete(tables.skill)
		.where(and(eq(tables.skill.id, id), eq(tables.skill.userId, user.id)))
		.returning({ id: tables.skill.id });

	if (!deleted) {
		throw new HTTPException(404, { message: "Skill not found" });
	}

	return c.json({ success: true });
});

// Default model for skill generation; must support tool calling.
const SKILL_GENERATION_MODEL = "openai/gpt-5-mini";

const SKILL_GENERATION_TIMEOUT_MS = 120_000;

const generatedSkillSchema = z.object({
	name: z
		.string()
		.trim()
		.min(1)
		.describe(
			"Short kebab-case identifier for the skill, e.g. 'brand-guidelines'. Max 100 characters.",
		),
	description: z
		.string()
		.trim()
		.min(1)
		.describe(
			"One or two sentences describing what the skill does and when to use it. Max 2000 characters.",
		),
	instructions: z
		.string()
		.trim()
		.min(1)
		.describe(
			"The full skill instructions in markdown. Detailed, actionable guidance the AI should follow when the skill is active.",
		),
});

const SKILL_CREATOR_SYSTEM = `You are a skill creator for LLM Gateway Chat. A skill is a reusable instruction set that guides an AI assistant in a specific context.

Given the user's request, design a high-quality skill and save it with the save_skill tool:
- name: short kebab-case identifier (e.g. "code-reviewer", "brand-guidelines")
- description: one or two sentences stating what the skill does and when it should be used
- instructions: thorough markdown instructions written as directives to the AI (role, goals, constraints, style, step-by-step behavior, edge cases). Use headings and lists where helpful.

Always call save_skill exactly once.`;

const generateSkill = createRoute({
	method: "post",
	path: "/generate",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						prompt: z.string().trim().min(1),
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
						skill: z.object({
							name: z.string(),
							description: z.string(),
							instructions: z.string(),
						}),
					}),
				},
			},
			description: "AI-generated skill draft",
		},
	},
});

skills.openapi(generateSkill, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { prompt } = c.req.valid("json");

	const token =
		c.req.header("x-llmgateway-key") ?? (await resolvePlaygroundToken(c, user));

	const gatewayUrl = getGatewayUrl();

	const llmgateway = createLLMGateway({
		apiKey: token,
		baseURL: gatewayUrl,
		headers: {
			...forwardedIpHeaders(c.req.raw.headers),
			"x-source": LOUNGE_SOURCE,
		},
	});

	const result = await generateText({
		experimental_download: deferDownloadsToGateway,
		model: llmgateway.chat(SKILL_GENERATION_MODEL),
		system: SKILL_CREATOR_SYSTEM,
		prompt,
		tools: {
			save_skill: tool({
				description: "Save the generated skill.",
				inputSchema: generatedSkillSchema,
			}),
		},
		toolChoice: "required",
		abortSignal: AbortSignal.any([
			c.req.raw.signal,
			AbortSignal.timeout(SKILL_GENERATION_TIMEOUT_MS),
		]),
	});

	const saveCall = result.toolCalls.find(
		(call) => call.toolName === "save_skill",
	);
	if (!saveCall) {
		throw new HTTPException(502, {
			message: "The model did not produce a skill",
		});
	}

	const parsed = generatedSkillSchema.safeParse(saveCall.input);
	if (!parsed.success) {
		throw new HTTPException(502, {
			message: "The model produced an invalid skill",
		});
	}

	const { name, description, instructions } = parsed.data;

	return c.json({
		skill: {
			name: name.slice(0, 100),
			description: description.slice(0, 2000),
			instructions,
		},
	});
});
