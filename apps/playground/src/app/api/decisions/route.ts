import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getPlaygroundKeyForRequest } from "@/lib/constants";
import { getUser } from "@/lib/getUser";

import { forwardedIpHeaders } from "@llmgateway/shared/client-ip";
import {
	DECISION_IMAGE_DATA_URL_PATTERN,
	MAX_DECISION_CHOICES,
	MAX_DECISION_IMAGE_DATA_URL_LENGTH,
	MAX_DECISION_INPUT_IMAGES,
	MAX_DECISION_LEVELS,
	MAX_DECISION_QUESTIONS,
	normalizeDecisionQuestions,
	validateDecisionQuestions,
} from "@llmgateway/shared/decision-studio";
import { getGatewayApiBaseUrl } from "@llmgateway/shared/gateway-url";
import { LOUNGE_SOURCE } from "@llmgateway/shared/lounge-source";

export const maxDuration = 60;

const MAX_INPUT_TEXT_LENGTH = 100_000;

const questionSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("predicate"),
		name: z.string().max(100),
		instructions: z.string().max(4000),
	}),
	z.object({
		type: z.literal("choice"),
		name: z.string().max(100),
		instructions: z.string().max(4000),
		choices: z
			.array(
				z.object({
					value: z.string().max(200),
					description: z.string().max(1000).optional(),
				}),
			)
			.min(2)
			.max(MAX_DECISION_CHOICES),
	}),
	z.object({
		type: z.literal("score"),
		name: z.string().max(100),
		instructions: z.string().max(4000),
		levels: z
			.array(
				z.object({
					label: z.string().max(200),
					description: z.string().max(1000).optional(),
				}),
			)
			.min(2)
			.max(MAX_DECISION_LEVELS),
	}),
]);

const inputPartSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("input_text"),
		text: z.string().max(MAX_INPUT_TEXT_LENGTH),
	}),
	z.object({
		type: z.literal("input_image"),
		// Only inline images from the studio; a URL would make the gateway
		// fetch whatever the client points it at.
		image_url: z
			.string()
			.max(MAX_DECISION_IMAGE_DATA_URL_LENGTH)
			.regex(DECISION_IMAGE_DATA_URL_PATTERN),
	}),
]);

const requestSchema = z.object({
	model: z.string().trim().min(1).max(200),
	input: z.union([
		z.string().max(MAX_INPUT_TEXT_LENGTH),
		z
			.array(
				z.object({
					role: z.literal("user"),
					content: z.array(inputPartSchema).min(1),
				}),
			)
			.min(1)
			.max(1),
	]),
	questions: z.array(questionSchema).min(1).max(MAX_DECISION_QUESTIONS),
});

function getDecisionErrorMessage(body: unknown, fallback: string): string {
	if (typeof body === "string" && body.length > 0) {
		return body;
	}
	if (body && typeof body === "object" && "error" in body) {
		const error = (body as { error: unknown }).error;
		if (typeof error === "string" && error.length > 0) {
			return error;
		}
		if (
			error &&
			typeof error === "object" &&
			"message" in error &&
			typeof (error as { message: unknown }).message === "string"
		) {
			return (error as { message: string }).message;
		}
	}
	return fallback;
}

type DecisionInput = z.infer<typeof requestSchema>["input"];

function inputIsEmpty(input: DecisionInput): boolean {
	if (typeof input === "string") {
		return input.trim().length === 0;
	}
	return !input.some((message) =>
		message.content.some(
			(part) => part.type === "input_image" || part.text.trim().length > 0,
		),
	);
}

function imageCount(input: DecisionInput): number {
	if (typeof input === "string") {
		return 0;
	}
	return input.reduce(
		(count, message) =>
			count +
			message.content.filter((part) => part.type === "input_image").length,
		0,
	);
}

export async function POST(req: Request) {
	const user = await getUser();
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const cookieStore = await cookies();
	const apiKey = getPlaygroundKeyForRequest(cookieStore);

	if (!apiKey) {
		return NextResponse.json({ error: "Missing API key" }, { status: 400 });
	}

	let raw: unknown;
	try {
		raw = await req.json();
	} catch {
		return NextResponse.json(
			{ error: "Invalid JSON payload" },
			{ status: 400 },
		);
	}

	const parsedRequest = requestSchema.safeParse(raw);
	if (!parsedRequest.success) {
		const issue = parsedRequest.error.issues[0];
		return NextResponse.json(
			{
				error: issue
					? `Invalid request: ${issue.path.join(".") || "body"} ${issue.message}`
					: "Invalid request",
			},
			{ status: 400 },
		);
	}
	const body = parsedRequest.data;

	if (inputIsEmpty(body.input)) {
		return NextResponse.json(
			{ error: "Missing input to decide on" },
			{ status: 400 },
		);
	}
	if (imageCount(body.input) > MAX_DECISION_INPUT_IMAGES) {
		return NextResponse.json(
			{ error: `Attach at most ${MAX_DECISION_INPUT_IMAGES} images` },
			{ status: 400 },
		);
	}
	const questionError = validateDecisionQuestions(body.questions);
	if (questionError) {
		return NextResponse.json({ error: questionError }, { status: 400 });
	}
	const questions = normalizeDecisionQuestions(body.questions);

	const noFallback = req.headers.get("x-no-fallback");

	// Abort just under maxDuration so a hung gateway connection surfaces as a
	// 504 instead of an opaque function timeout.
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 55_000);

	let response: Response;
	try {
		response = await fetch(`${getGatewayApiBaseUrl()}/decisions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
				...forwardedIpHeaders(req.headers),
				"x-source": LOUNGE_SOURCE,
				...(noFallback ? { "x-no-fallback": noFallback } : {}),
			},
			body: JSON.stringify({
				model: body.model,
				input: body.input,
				questions,
			}),
			signal: controller.signal,
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			return NextResponse.json(
				{ error: "The decision request timed out" },
				{ status: 504 },
			);
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}

	const text = await response.text();
	let parsed: unknown = null;
	if (text) {
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = text;
		}
	}

	if (!response.ok) {
		return NextResponse.json(
			{ error: getDecisionErrorMessage(parsed, "The decision request failed") },
			{ status: response.status },
		);
	}

	if (!parsed || typeof parsed !== "object" || !("answers" in parsed)) {
		return NextResponse.json(
			{ error: "The model returned no answers" },
			{ status: 502 },
		);
	}

	return NextResponse.json(parsed);
}
