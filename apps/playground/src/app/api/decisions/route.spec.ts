import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const fixture = vi.hoisted(() => ({
	apiKey: "pk-fixture" as string | undefined,
	user: { id: "fixture-user" } as { id: string } | null,
}));
vi.mock("next/headers", () => ({
	cookies: async () => ({ get: () => undefined }),
}));
vi.mock("@/lib/getUser", () => ({
	getUser: async () => fixture.user,
}));
vi.mock("@/lib/constants", () => ({
	getPlaygroundKeyForRequest: () => fixture.apiKey,
}));
vi.mock("@llmgateway/shared/gateway-url", () => ({
	getGatewayApiBaseUrl: () => "https://gateway.test/v1",
}));

const fetchMock = vi.fn();

const questions = [
	{ type: "predicate", name: "is_urgent", instructions: "Is it urgent?" },
];

function request(body: unknown, headers: Record<string, string> = {}) {
	return new Request("http://localhost/api/decisions", {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

beforeEach(() => {
	fixture.apiKey = "pk-fixture";
	fixture.user = { id: "fixture-user" };
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("POST /api/decisions", () => {
	it("rejects unauthenticated requests", async () => {
		fixture.user = null;
		const response = await POST(request({}));
		expect(response.status).toBe(401);
	});

	it("rejects a missing playground key", async () => {
		fixture.apiKey = undefined;
		const response = await POST(request({}));
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Missing API key" });
	});

	it("validates the body before calling the gateway", async () => {
		const empty = await POST(request({ model: "m", input: "   ", questions }));
		expect(empty.status).toBe(400);

		const badQuestion = await POST(
			request({
				model: "m",
				input: "hello",
				questions: [
					{
						type: "choice",
						name: "",
						instructions: "x",
						choices: [{ value: "a" }, { value: "" }],
					},
				],
			}),
		);
		expect(badQuestion.status).toBe(400);
		expect((await badQuestion.json()).error).toMatch(/two named options/);

		const malformed = await POST(
			request({ model: "m", input: "hello", questions: [{ type: "choice" }] }),
		);
		expect(malformed.status).toBe(400);

		const remoteImage = await POST(
			request({
				model: "m",
				input: [
					{
						role: "user",
						content: [
							{ type: "input_image", image_url: "https://example.com/x.png" },
						],
					},
				],
				questions,
			}),
		);
		expect(remoteImage.status).toBe(400);

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("forwards the request to /v1/decisions and returns the answers", async () => {
		const answers = [
			{ type: "predicate", name: "is_urgent", probability: 0.92 },
		];
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ model: "openai/m", answers }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);

		const response = await POST(
			request(
				{ model: "m", input: "Help, my payouts fail", questions },
				{ "x-no-fallback": "true" },
			),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ model: "openai/m", answers });

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://gateway.test/v1/decisions");
		const headers = init.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer pk-fixture");
		expect(headers["x-no-fallback"]).toBe("true");
		expect(JSON.parse(init.body as string)).toEqual({
			model: "m",
			input: "Help, my payouts fail",
			questions,
		});
	});

	it("normalizes questions before forwarding them", async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ answers: [] }), { status: 200 }),
		);
		await POST(
			request({
				model: "m",
				input: "hello",
				questions: [
					{ type: "predicate", name: "  ", instructions: " Is it urgent? " },
				],
			}),
		);
		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(JSON.parse(init.body as string).questions).toEqual([
			{ type: "predicate", name: "q1", instructions: "Is it urgent?" },
		]);
	});

	it("surfaces gateway errors with their status and message", async () => {
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify({ error: { message: "Insufficient credits" } }),
				{ status: 402 },
			),
		);
		const response = await POST(
			request({ model: "m", input: "hello", questions }),
		);
		expect(response.status).toBe(402);
		expect(await response.json()).toEqual({ error: "Insufficient credits" });
	});

	it("treats a success body without answers as a bad gateway", async () => {
		fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
		const response = await POST(
			request({ model: "m", input: "hello", questions }),
		);
		expect(response.status).toBe(502);
	});
});
