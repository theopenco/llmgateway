import { generateText, tool } from "ai";
import { cookies } from "next/headers";
import { z } from "zod";

import { PLAYGROUND_KEY_COOKIE_NAME } from "@/lib/constants";
import { getUser } from "@/lib/getUser";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";

export const maxDuration = 120;

// Default model for skill generation; must support tool calling.
const SKILL_GENERATION_MODEL = "openai/gpt-5-mini";

const SKILL_NAME_MAX = 100;
const SKILL_DESCRIPTION_MAX = 2000;

const skillSchema = z.object({
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

export async function POST(req: Request) {
	const user = await getUser();

	if (!user) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), {
			status: 401,
		});
	}

	let body: { prompt?: unknown };
	try {
		body = await req.json();
	} catch {
		return new Response(JSON.stringify({ error: "Malformed JSON body" }), {
			status: 400,
		});
	}
	const prompt = body?.prompt;

	if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
		return new Response(JSON.stringify({ error: "Missing prompt" }), {
			status: 400,
		});
	}

	const headerApiKey = req.headers.get("x-llmgateway-key") ?? undefined;
	const cookieStore = await cookies();
	const cookieApiKey =
		cookieStore.get(PLAYGROUND_KEY_COOKIE_NAME)?.value ??
		cookieStore.get(`__Host-${PLAYGROUND_KEY_COOKIE_NAME}`)?.value;
	const finalApiKey = headerApiKey ?? cookieApiKey;

	if (!finalApiKey) {
		return new Response(JSON.stringify({ error: "Missing API key" }), {
			status: 400,
		});
	}

	const gatewayUrl =
		process.env.GATEWAY_URL ??
		(process.env.NODE_ENV === "development"
			? "http://localhost:4001/v1"
			: "https://api.llmgateway.io/v1");

	const llmgateway = createLLMGateway({
		apiKey: finalApiKey,
		baseURL: gatewayUrl,
		headers: {
			"x-source": "chat.llmgateway.io",
		},
	});

	try {
		const result = await generateText({
			model: llmgateway.chat(SKILL_GENERATION_MODEL),
			system: SKILL_CREATOR_SYSTEM,
			prompt: prompt.trim(),
			tools: {
				save_skill: tool({
					description: "Save the generated skill.",
					inputSchema: skillSchema,
				}),
			},
			toolChoice: "required",
		});

		const saveCall = result.toolCalls.find(
			(call) => call.toolName === "save_skill",
		);

		if (!saveCall) {
			return new Response(
				JSON.stringify({ error: "The model did not produce a skill" }),
				{ status: 502 },
			);
		}

		const parsed = skillSchema.safeParse(saveCall.input);

		if (!parsed.success) {
			return new Response(
				JSON.stringify({ error: "The model produced an invalid skill" }),
				{ status: 502 },
			);
		}

		const { name, description, instructions } = parsed.data;

		return Response.json({
			skill: {
				name: name.trim().slice(0, SKILL_NAME_MAX),
				description: description.trim().slice(0, SKILL_DESCRIPTION_MAX),
				instructions: instructions.trim(),
			},
		});
	} catch (error: unknown) {
		const message =
			error instanceof Error ? error.message : "Skill generation failed";
		const status =
			typeof error === "object" &&
			error !== null &&
			"status" in error &&
			typeof (error as { status: unknown }).status === "number"
				? (error as { status: number }).status
				: 500;
		return new Response(JSON.stringify({ error: message }), { status });
	}
}
