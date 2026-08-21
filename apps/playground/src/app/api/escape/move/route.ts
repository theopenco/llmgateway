import { generateText } from "ai";
import { cookies } from "next/headers";

import { getPlaygroundKeyForRequest } from "@/lib/constants";
import { getUser } from "@/lib/getUser";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";
import { getGatewayApiBaseUrl } from "@llmgateway/shared/gateway-url";
import { LOUNGE_SOURCE } from "@llmgateway/shared/lounge-source";
import {
	applyMove,
	buildTurnPrompt,
	ESCAPE_SYSTEM_PROMPT,
	ESCAPE_MAX_MOVES,
	isDirection,
	isValidLevelId,
	parseMoveResponse,
	replayGame,
} from "@llmgateway/shared/sandbox-escape";

import type { Direction } from "@llmgateway/shared/sandbox-escape";

export const maxDuration = 120;

/**
 * A ceiling rather than a target: it keeps a rambling model from burning the
 * player's credits on one turn, while leaving reasoning models room to think.
 */
const MAX_OUTPUT_TOKENS = 2048;

interface MoveRequestBody {
	levelId?: unknown;
	moves?: unknown;
	model?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function readGatewayUsage(
	providerMetadata: unknown,
): Record<string, unknown> | undefined {
	if (!isRecord(providerMetadata)) {
		return undefined;
	}
	const llmgateway = providerMetadata.llmgateway;
	if (!isRecord(llmgateway) || !isRecord(llmgateway.usage)) {
		return undefined;
	}
	return llmgateway.usage;
}

function badRequest(message: string, status = 400) {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export async function POST(req: Request) {
	const user = await getUser();

	if (!user) {
		return badRequest("Unauthorized", 401);
	}

	let body: MoveRequestBody;
	try {
		body = (await req.json()) as MoveRequestBody;
	} catch {
		return badRequest("Invalid JSON");
	}

	const levelId = Number(body.levelId);
	if (!isValidLevelId(levelId)) {
		return badRequest("Unknown level");
	}

	const rawMoves = Array.isArray(body.moves) ? body.moves : [];
	if (rawMoves.length > ESCAPE_MAX_MOVES || !rawMoves.every(isDirection)) {
		return badRequest("Invalid move history");
	}

	const model = typeof body.model === "string" ? body.model.trim() : "";
	if (!model) {
		return badRequest("Missing model");
	}

	// The client only ever holds a move list; the board it sees is rebuilt here
	// from the deterministic engine, so it can neither invent a state nor skip a
	// turn it already paid for.
	const state = replayGame(levelId, rawMoves as Direction[]);
	if (state.outcome !== "running") {
		return badRequest("This run has already finished");
	}

	const headerApiKey = req.headers.get("x-llmgateway-key")?.trim() || undefined;
	const cookieStore = await cookies();
	const cookieApiKey = getPlaygroundKeyForRequest(cookieStore, req)?.trim();
	const apiKey = headerApiKey || cookieApiKey;

	if (!apiKey) {
		return badRequest("Missing API key");
	}

	const llmgateway = createLLMGateway({
		apiKey,
		baseURL: getGatewayApiBaseUrl(),
		headers: { "x-source": LOUNGE_SOURCE },
		// Picking one of five directions is a decision, not an essay. Left at
		// their default effort, reasoning models spend ~1.3k thinking tokens per
		// move, which makes a single level cost more and take minutes. Providers
		// that do not support the field ignore it.
		extraBody: { reasoning_effort: "low" },
	});

	const startedAt = Date.now();
	let result: Awaited<ReturnType<typeof generateText>>;
	try {
		result = await generateText({
			model: llmgateway.chat(model as Parameters<typeof llmgateway.chat>[0], {
				usage: { include: true },
			}),
			system: ESCAPE_SYSTEM_PROMPT,
			messages: [{ role: "user", content: buildTurnPrompt(state) }],
			maxOutputTokens: MAX_OUTPUT_TOKENS,
		});
	} catch (error) {
		// Insufficient credits is the likeliest failure here, and the player can
		// only act on it if they see it — letting the throw become a generic 500
		// would surface as "the model could not take a turn".
		return badRequest(
			error instanceof Error ? error.message : "The gateway call failed",
			502,
		);
	}

	const parsed = parseMoveResponse(result.text);
	// A model that cannot name a move still spent a turn deciding, so the turn
	// is spent. Waiting is the honest resolution: it costs a step and lets a
	// model that simply cannot play run itself out of budget.
	const move: Direction = parsed?.move ?? "wait";
	const nextState = applyMove(state, move);

	const gatewayUsage = readGatewayUsage(result.providerMetadata);

	return Response.json({
		move,
		thought: parsed?.thought ?? "",
		understood: parsed !== null,
		state: nextState,
		usedModel: result.response?.modelId ?? null,
		usage: {
			promptTokens:
				readNumber(gatewayUsage?.promptTokens) ?? result.usage.inputTokens ?? 0,
			completionTokens:
				readNumber(gatewayUsage?.completionTokens) ??
				result.usage.outputTokens ??
				0,
			cost: readNumber(gatewayUsage?.cost) ?? 0,
			durationMs: Date.now() - startedAt,
		},
	});
}
