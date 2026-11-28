import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { responses } from "./responses.js";

import type { GatewayApiKey } from "@/lib/cached-queries.js";

vi.mock("@/lib/gateway-read-access.js", () => ({
	getAuthenticatedReadAccess: state.readAccess,
}));

const state = vi.hoisted(() => ({
	key: {
		id: "key",
		projectId: "project",
		keyType: "user",
		status: "active",
		expiresAt: null as Date | null,
		endUserSession: undefined as GatewayApiKey["endUserSession"],
	},
	project: {
		id: "project",
		organizationId: "org",
		status: "active",
		allowedOrigins: ["https://allowed.example"],
	},
	wallet: { id: "wallet", status: "active", balance: "1", mode: "live" },
	stored: vi.fn(),
	store: vi.fn(),
	zdr: false,
	readAccess: vi.fn(),
	forward: vi.fn(),
	budget: vi.fn(),
	limits: vi.fn(),
	streamSSE: vi.fn(),
}));
vi.mock("@/app.js", () => ({ app: { request: state.forward } }));
vi.mock("@/lib/cached-queries.js", () => ({
	findApiKeyByToken: vi.fn(() => state.key),
	findProjectById: vi.fn(() => state.project),
	findOrganizationById: vi.fn(() => ({ id: "org", status: "active" })),
	findWalletById: vi.fn(() => state.wallet),
}));
vi.mock("@/lib/api-key-usage-limits.js", () => ({
	assertMemberProjectAccess: vi.fn(),
	assertMemberWithinBudget: state.budget,
	assertApiKeyWithinUsageLimits: state.limits,
}));
vi.mock("@/lib/compliance.js", () => ({
	isZeroDataRetentionEnabled: vi.fn(() => state.zdr),
}));
vi.mock("@/lib/client-error-log.js", () => ({
	logGatewayClientError: vi.fn(),
}));
vi.mock("@/lib/pending-work.js", () => ({ streamSSE: state.streamSSE }));
vi.mock("@/lib/responses-context.js", () => ({
	setResponsesContext: vi.fn(),
	deleteResponsesContext: vi.fn(),
}));
vi.mock("@/lib/prompt-template.js", () => ({
	PROMPT_RESPONSE_HEADERS: [],
	resolvePromptModel: vi.fn(),
}));
vi.mock("@llmgateway/db", () => ({ shortid: vi.fn(() => "response-id") }));
vi.mock("@llmgateway/logger", () => ({
	logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("./tools/response-state.js", () => ({
	getStoredResponse: state.stored,
	storeResponse: state.store,
	resolveItemReferences: vi.fn((items) => items),
}));

function session() {
	state.key.keyType = "platform";
	state.key.endUserSession = {
		id: "session",
		walletId: "wallet",
		endCustomerId: "customer",
		expiresAt: new Date(Date.now() + 60_000),
		scope: { models: ["gpt-4o"] },
		walletStatus: "active",
		endCustomerStatus: "active",
		projectStatus: "active",
	};
	return state.key.endUserSession;
}
function chatCompletion() {
	return Response.json({
		id: "chat",
		model: "gpt-4o",
		choices: [
			{
				message: { role: "assistant", content: "Hello" },
				finish_reason: "stop",
			},
		],
		usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
	});
}
function request(
	path = "/saved",
	body?: Record<string, unknown>,
	origin?: string,
) {
	return responses.request(path, {
		method: body ? "POST" : "GET",
		headers: {
			Authorization: "Bearer test-token",
			"Content-Type": "application/json",
			...(origin ? { Origin: origin } : {}),
		},
		...(body ? { body: JSON.stringify(body) } : {}),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	state.readAccess.mockReset();
	state.forward.mockReset();
	state.streamSSE.mockReset();
	state.key.keyType = "user";
	state.key.expiresAt = null;
	state.key.endUserSession = undefined;
	state.project.status = "active";
	state.wallet.status = "active";
	state.zdr = false;
	state.forward.mockImplementation(() =>
		Response.json(
			{
				error: {
					message: "Downstream validation",
					type: "invalid_request_error",
				},
			},
			{ status: 422 },
		),
	);
	state.stored.mockResolvedValue({
		id: "saved",
		input: [],
		output: [],
		model: "gpt-4o",
		status: "completed",
	});
});
describe("Responses principals", () => {
	it("keeps regular-key historical reads independent of spend limits", async () => {
		expect((await request()).status).toBe(200);
		expect(state.budget).not.toHaveBeenCalled();
		expect(state.limits).not.toHaveBeenCalled();
		expect(state.stored).toHaveBeenCalledWith("saved", "project");
		expect(state.readAccess).toHaveBeenCalledOnce();
		expect(state.readAccess).toHaveBeenCalledBefore(state.stored);
	});
	it("rejects private reads denied by read-access checks before storage", async () => {
		state.readAccess.mockRejectedValueOnce(
			new HTTPException(403, { message: "Access denied by an IP restriction" }),
		);
		expect((await request()).status).toBe(403);
		expect(state.readAccess).toHaveBeenCalledOnce();
		expect(state.stored).not.toHaveBeenCalled();
	});
	it("rejects expired regular keys before reading storage", async () => {
		state.key.expiresAt = new Date(Date.now() - 1);
		expect((await request()).status).toBe(401);
		expect(state.stored).not.toHaveBeenCalled();
	});
	it("rejects archived projects before reading storage", async () => {
		state.project.status = "deleted";
		expect((await request()).status).toBe(410);
		expect(state.stored).not.toHaveBeenCalled();
	});
	it("rejects publishable keys before reading storage", async () => {
		state.key.keyType = "platform_publishable";
		expect((await request()).status).toBe(401);
		expect(state.stored).not.toHaveBeenCalled();
	});
	it("rejects expired SDK retrieval before reading storage", async () => {
		session().expiresAt = new Date(Date.now() - 1);
		expect((await request()).status).toBe(401);
		expect(state.stored).not.toHaveBeenCalled();
	});
	it("rejects frozen SDK wallets before reading storage", async () => {
		session();
		state.wallet.status = "frozen";
		const response = await request();
		expect(response.status).toBe(402);
		expect(await response.json()).toMatchObject({
			error: { code: "unauthorized" },
		});
		expect(state.readAccess).not.toHaveBeenCalled();
		expect(state.stored).not.toHaveBeenCalled();
	});
	it("rejects SDK retrieval because storage is project scoped", async () => {
		session();
		expect((await request()).status).toBe(403);
		expect(state.readAccess).not.toHaveBeenCalled();
		expect(state.stored).not.toHaveBeenCalled();
	});
	it.each(["/", "/compact"])(
		"allows SDK generation without stored history through %s",
		async (path) => {
			session();
			expect(
				(
					await request(
						path,
						{ model: "gpt-4o", input: "hi", store: false },
						"https://allowed.example",
					)
				).status,
			).toBe(422);
			expect(state.forward).toHaveBeenCalledOnce();
			expect(state.stored).not.toHaveBeenCalled();
		},
	);
	it.each(["/", "/compact"])(
		"rejects SDK history reads through %s",
		async (path) => {
			session();
			expect(
				(
					await request(path, {
						model: "gpt-4o",
						input: "hi",
						previous_response_id: "saved",
					})
				).status,
			).toBe(403);
			expect(state.stored).not.toHaveBeenCalled();
			expect(state.forward).not.toHaveBeenCalled();
		},
	);
	it("does not store SDK responses that omit store", async () => {
		session();
		state.forward.mockResolvedValueOnce(chatCompletion());
		const response = await request(
			"/",
			{ model: "gpt-4o", input: "hi" },
			"https://allowed.example",
		);
		expect(response.status).toBe(200);
		expect(state.forward).toHaveBeenCalledOnce();
		expect(state.store).not.toHaveBeenCalled();
	});
	it("stores regular-key responses that omit store", async () => {
		state.forward.mockResolvedValueOnce(chatCompletion());
		const response = await request("/", { model: "gpt-4o", input: "hi" });
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ store: true });
		expect(state.store).toHaveBeenCalledOnce();
		expect(state.store).toHaveBeenCalledWith(
			"resp_response-id",
			expect.anything(),
			"project",
		);
	});
	it.each([
		[false, undefined],
		[false, true],
		[true, undefined],
		[true, true],
	])(
		"echoes store false for unstored SDK responses with ZDR=%s and store=%s",
		async (zdr, store) => {
			session();
			state.zdr = zdr;
			state.forward.mockResolvedValueOnce(chatCompletion());
			const response = await request(
				"/",
				{ model: "gpt-4o", input: "hi", ...(store !== undefined && { store }) },
				"https://allowed.example",
			);
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({
				object: "response",
				store: false,
			});
			expect(state.forward).toHaveBeenCalledOnce();
			expect(state.store).not.toHaveBeenCalled();
		},
	);
	it.each([false, true])(
		"echoes store false in streamed SDK responses with ZDR=%s",
		async (zdr) => {
			session();
			state.zdr = zdr;
			const events: { event?: string; data: string }[] = [];
			state.streamSSE.mockImplementationOnce(
				async (
					c: { body: (body: null) => Response },
					callback: (stream: unknown) => Promise<void>,
				) => {
					await callback({
						aborted: false,
						write: vi.fn(async () => undefined),
						writeSSE: vi.fn(async (event: { event?: string; data: string }) => {
							events.push(event);
						}),
					});
					return c.body(null);
				},
			);
			const chunk = {
				id: "chat",
				model: "gpt-4o",
				choices: [
					{ index: 0, delta: { content: "Hello" }, finish_reason: "stop" },
				],
				usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
			};
			state.forward.mockResolvedValueOnce(
				new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
					headers: { "Content-Type": "text/event-stream" },
				}),
			);
			const response = await request(
				"/",
				{ model: "gpt-4o", input: "hi", stream: true },
				"https://allowed.example",
			);
			expect(response.status).toBe(200);
			const lifecycle = events
				.filter(
					(event) =>
						event.event === "response.created" ||
						event.event === "response.completed",
				)
				.map((event) => JSON.parse(event.data).response.store);
			expect(lifecycle).toEqual([false, false]);
			expect(state.store).not.toHaveBeenCalled();
		},
	);
	it("still rejects regular-key responses that omit store under ZDR", async () => {
		state.zdr = true;
		const response = await request("/", { model: "gpt-4o", input: "hi" });
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			error: { code: "zdr_storage_conflict" },
		});
		expect(state.forward).not.toHaveBeenCalled();
		expect(state.store).not.toHaveBeenCalled();
	});
	it.each(["/", "/compact"])(
		"rejects SDK item references through %s",
		async (path) => {
			session();
			expect(
				(
					await request(path, {
						model: "gpt-4o",
						input: [{ type: "item_reference", id: "item" }],
					})
				).status,
			).toBe(403);
			expect(state.forward).not.toHaveBeenCalled();
		},
	);
	it.each(["/", "/compact"])(
		"validates SDK expiry before forwarding %s",
		async (path) => {
			session().expiresAt = new Date(Date.now() - 1);
			expect(
				(await request(path, { model: "gpt-4o", input: "hi" })).status,
			).toBe(401);
			expect(state.forward).not.toHaveBeenCalled();
		},
	);
	it.each(["/", "/compact"])(
		"validates SDK origin before forwarding %s",
		async (path) => {
			session();
			expect(
				(
					await request(
						path,
						{ model: "gpt-4o", input: "hi" },
						"https://denied.example",
					)
				).status,
			).toBe(403);
			expect(state.forward).not.toHaveBeenCalled();
		},
	);
	it.each([false, true])(
		"successful SDK compaction remains stateless with ZDR=%s",
		async (zdr) => {
			session();
			state.zdr = zdr;
			state.forward.mockResolvedValueOnce(
				Response.json({
					id: "chat",
					model: "gpt-4o",
					choices: [
						{
							message: { role: "assistant", content: "Compact summary" },
							finish_reason: "stop",
						},
					],
					usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
				}),
			);
			const response = await request(
				"/compact",
				{ model: "gpt-4o", input: "SDK conversation" },
				"https://allowed.example",
			);
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({
				object: "response.compaction",
				output: expect.arrayContaining([
					expect.objectContaining({ type: "compaction" }),
				]),
			});
			expect(state.forward).toHaveBeenCalledOnce();
			expect(state.store).not.toHaveBeenCalled();
			expect(state.stored).not.toHaveBeenCalled();
		},
	);

	it.each([false, true])(
		"regular-key compaction preserves existing storage with ZDR=%s",
		async (zdr) => {
			state.zdr = zdr;
			state.forward.mockResolvedValueOnce(
				Response.json({
					id: "chat",
					model: "gpt-4o",
					choices: [
						{
							message: { role: "assistant", content: "Compact summary" },
							finish_reason: "stop",
						},
					],
					usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
				}),
			);
			const response = await request("/compact", {
				model: "gpt-4o",
				input: "Regular conversation",
			});
			expect(response.status).toBe(200);
			expect(state.store).toHaveBeenCalledTimes(zdr ? 0 : 1);
			if (!zdr) {
				expect(state.store).toHaveBeenCalledWith(
					expect.any(String),
					expect.objectContaining({
						input: [
							{
								type: "message",
								role: "user",
								content: "Regular conversation",
							},
						],
					}),
					"project",
				);
			}
		},
	);
});
