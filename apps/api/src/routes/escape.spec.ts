import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";
import { getApiKeyFingerprints } from "@llmgateway/shared/api-key-hash";
import { LOUNGE_SOURCE } from "@llmgateway/shared/lounge-source";
import {
	applyMove,
	buildTurnPrompt,
	ESCAPE_MAX_MOVES,
	replayGame,
	scoreGame,
} from "@llmgateway/shared/sandbox-escape";

import type { MockInstance } from "vitest";

function completion(
	content = '{"move":"right","thought":"Try the next corridor"}',
) {
	return Response.json({
		id: "chatcmpl-escape",
		object: "chat.completion",
		created: 1,
		model: "openai/gpt-4o-mini",
		choices: [
			{
				index: 0,
				message: { role: "assistant", content },
				finish_reason: "stop",
			},
		],
		usage: {
			prompt_tokens: 17,
			completion_tokens: 9,
			total_tokens: 26,
			cost: 0.001,
		},
	});
}
const turnSchema = z.object({
	move: z.string(),
	understood: z.boolean(),
	thought: z.string(),
	state: z
		.object({
			levelId: z.number(),
			step: z.number(),
			moves: z.array(z.string()),
			player: z.object({ x: z.number(), y: z.number() }),
		})
		.passthrough(),
	usage: z.object({
		promptTokens: z.number(),
		completionTokens: z.number(),
		cost: z.number(),
	}),
});

describe("Escape API", () => {
	let cookie: string;
	let upstream: MockInstance<typeof fetch>;
	beforeEach(async () => {
		cookie = await createTestUser();
		await db.insert(tables.organization).values([
			{
				id: "escape-org",
				name: "Escape Test",
				billingEmail: "admin@example.com",
				plan: "enterprise",
			},
			{
				id: "escape-other-org",
				name: "Other Test",
				billingEmail: "admin@example.com",
			},
			{
				id: "escape-personal",
				name: "Personal Test",
				kind: "chat",
				billingEmail: "admin@example.com",
			},
		]);
		await db.insert(tables.project).values([
			{
				id: "escape-project",
				name: "Escape Project",
				organizationId: "escape-org",
			},
			{
				id: "escape-restricted",
				name: "Restricted Project",
				organizationId: "escape-org",
			},
			{
				id: "escape-other",
				name: "Other Project",
				organizationId: "escape-other-org",
			},
		]);
		await db.insert(tables.userOrganization).values({
			id: "escape-member",
			userId: "test-user-id",
			organizationId: "escape-org",
			role: "owner",
		});
		upstream = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () => completion());
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		await deleteAll();
	});
	function request(
		body: Record<string, unknown> = {},
		headers: Record<string, string> = { Cookie: cookie },
		signal?: AbortSignal,
	) {
		return app.request("/escape/move", {
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			signal,
			body: JSON.stringify({
				projectId: "escape-project",
				levelId: 1,
				moves: [],
				model: "openai/gpt-4o-mini",
				...body,
			}),
		});
	}
	it("requires a session before billing", async () => {
		expect((await request({}, {})).status).toBe(401);
		expect(upstream).not.toHaveBeenCalled();
	});
	it.each([
		{ levelId: 0 },
		{ levelId: 99 },
		{ moves: ["teleport"] },
		{ moves: Array(ESCAPE_MAX_MOVES + 1).fill("wait") },
		{ model: " " },
		{ projectId: "" },
		{ state: { outcome: "escaped" } },
	])("rejects invalid input without calling the model: %j", async (body) => {
		expect((await request(body)).status).toBe(400);
		expect(upstream).not.toHaveBeenCalled();
	});
	it("rejects inaccessible and inactive projects before provisioning keys", async () => {
		expect((await request({ projectId: "escape-other" })).status).toBe(403);
		await db
			.update(tables.project)
			.set({ status: "inactive" })
			.where(eq(tables.project.id, "escape-project"));
		expect((await request()).status).toBe(404);
		expect(await db.query.apiKey.findMany()).toHaveLength(0);
		expect(upstream).not.toHaveBeenCalled();
	});
	it("enforces developer project grants", async () => {
		await db
			.update(tables.userOrganization)
			.set({ role: "developer" })
			.where(eq(tables.userOrganization.id, "escape-member"));
		await db.insert(tables.userProject).values({
			userOrganizationId: "escape-member",
			projectId: "escape-project",
		});
		expect((await request({ projectId: "escape-restricted" })).status).toBe(
			403,
		);
		expect(upstream).not.toHaveBeenCalled();
		expect((await request()).status).toBe(200);
	});
	it("rejects finished runs before billing", async () => {
		expect(
			(await request({ moves: Array(ESCAPE_MAX_MOVES).fill("wait") })).status,
		).toBe(400);
		expect(upstream).not.toHaveBeenCalled();
	});
	it("replays history, bills the selected project and returns the next board with usage", async () => {
		const response = await request({ moves: ["wait"] });
		expect(response.status).toBe(200);
		const turn = turnSchema.parse(await response.json());
		const previous = replayGame(1, ["wait"]);
		expect(turn.state).toEqual(
			JSON.parse(JSON.stringify(applyMove(previous, "right"))),
		);
		expect(turn.usage).toEqual({
			promptTokens: 17,
			completionTokens: 9,
			cost: 0.001,
		});
		expect(turn.understood).toBe(true);
		const init = upstream.mock.calls[0][1];
		const body = z
			.object({
				model: z.string(),
				messages: z.array(z.object({ role: z.string(), content: z.unknown() })),
				max_tokens: z.number(),
				reasoning_effort: z.string().optional(),
			})
			.parse(JSON.parse(String(init?.body)));
		expect(body.max_tokens).toBe(2048);
		expect(body.reasoning_effort).toBeUndefined();
		expect(JSON.stringify(body.messages)).toContain(
			JSON.stringify(buildTurnPrompt(previous)).slice(1, -1),
		);
		const headers = new Headers(init?.headers);
		expect(headers.get("x-source")).toBe(LOUNGE_SOURCE);
		expect(headers.get("x-no-fallback")).toBe("true");
		const token = headers.get("Authorization")!.replace("Bearer ", "");
		const keys = await db.query.apiKey.findMany();
		expect(keys).toHaveLength(1);
		expect(keys[0]).toMatchObject({
			projectId: "escape-project",
			createdBy: "test-user-id",
			kind: "playground",
		});
		expect(getApiKeyFingerprints(token)).toContain(keys[0].tokenHash);
		const hash = keys[0].tokenHash;
		expect(
			(await request({}, { Cookie: cookie, "x-llmgateway-key": token })).status,
		).toBe(200);
		expect((await db.query.apiKey.findMany())[0].tokenHash).toBe(hash);
	});
	it("requests low reasoning only for a model that supports it", async () => {
		expect((await request({ model: "openai/gpt-5-mini" })).status).toBe(200);
		const body = JSON.parse(String(upstream.mock.calls[0][1]?.body)) as {
			reasoning_effort?: string;
		};
		expect(body.reasoning_effort).toBe("low");
	});
	it("counts an unparseable model response as a wait turn", async () => {
		upstream.mockResolvedValueOnce(completion("I cannot choose."));
		const turn = turnSchema.parse(await (await request()).json());
		expect(turn).toMatchObject({
			move: "wait",
			understood: false,
			state: { step: 1, moves: ["wait"] },
		});
	});
	it.each([402, 429, 500])(
		"surfaces upstream %i without silently retrying a billable turn",
		async (status) => {
			upstream.mockImplementation(async () =>
				Response.json(
					{ error: { message: "Fixture upstream failure", type: "fixture" } },
					{ status },
				),
			);
			const response = await request();
			expect(response.status).toBe(status === 500 ? 502 : status);
			expect(upstream).toHaveBeenCalledTimes(1);
			if (status === 402) {
				expect(await response.text()).toContain("website");
			}
		},
	);
	it("records a finished run with server-derived scoring and a public replay", async () => {
		const save = (moves: string[], extra: Record<string, unknown> = {}) =>
			app.request("/escape/runs", {
				method: "POST",
				headers: { "Content-Type": "application/json", Cookie: cookie },
				body: JSON.stringify({
					levelId: 1,
					model: "model",
					organizationId: "escape-org",
					moves,
					...extra,
				}),
			});
		expect((await save([])).status).toBe(400);
		expect((await save(["wait"])).status).toBe(400);
		const moves = Array(ESCAPE_MAX_MOVES).fill("wait");
		expect(
			(await save(moves, { organizationId: "escape-other-org" })).status,
		).toBe(403);
		const response = await save(moves, { score: 999999 });
		expect(response.status).toBe(200);
		const { run } = z
			.object({
				run: z.object({
					id: z.string(),
					score: z.number(),
					steps: z.number(),
					outcome: z.string(),
				}),
			})
			.parse(await response.json());
		const state = replayGame(1, moves);
		expect(run).toMatchObject({
			score: scoreGame(state).score,
			steps: state.step,
			outcome: state.outcome,
		});
		const replay = await app.request(`/public/escape/runs/${run.id}`);
		expect(replay.status).toBe(200);
		expect(
			z
				.object({ run: z.object({ moves: z.array(z.string()) }) })
				.parse(await replay.json()).run.moves,
		).toEqual(state.moves);
		const leaderboard = await app.request(
			"/public/escape/leaderboard?levelId=1",
		);
		expect(leaderboard.status).toBe(200);
		expect(await leaderboard.json()).toMatchObject({
			totalRuns: 1,
			totalEscapes: 0,
		});
		expect(upstream).not.toHaveBeenCalled();
	});
	it("does not send a canceled turn to the provider", async () => {
		const controller = new AbortController();
		controller.abort();
		const response = await request({}, { Cookie: cookie }, controller.signal);
		expect(response.status).toBe(504);
		expect(upstream).not.toHaveBeenCalled();
	});
	it("lists only the caller's runs with workspace filtering and stable pagination", async () => {
		await db.insert(tables.user).values({
			id: "escape-other-user",
			name: "Other Test",
			email: "other@example.com",
		});
		const run = {
			userId: "test-user-id",
			levelId: 1,
			model: "model",
			outcome: "timeout" as const,
			steps: 3,
			par: 3,
			score: 0,
			moves: ["wait"],
			createdAt: new Date("2026-01-01T00:00:00Z"),
		};
		await db.insert(tables.sandboxEscapeRun).values([
			{ ...run, id: "escape-a", organizationId: "escape-org" },
			{ ...run, id: "escape-b", organizationId: "escape-org" },
			{ ...run, id: "escape-personal-run", organizationId: "escape-personal" },
			{ ...run, id: "escape-legacy", organizationId: null },
			{
				...run,
				id: "escape-private",
				userId: "escape-other-user",
				organizationId: "escape-org",
			},
		]);
		const list = async (query: string) => {
			const response = await app.request(`/escape/runs?${query}`, {
				headers: { Cookie: cookie },
			});
			expect(response.status).toBe(200);
			return z
				.object({
					runs: z.array(z.object({ id: z.string() })),
					hasMore: z.boolean(),
				})
				.parse(await response.json());
		};
		expect(await list("organizationId=escape-org&limit=1")).toEqual({
			runs: [{ id: "escape-b" }],
			hasMore: true,
		});
		expect(await list("organizationId=escape-org&limit=1&offset=1")).toEqual({
			runs: [{ id: "escape-a" }],
			hasMore: false,
		});
		expect(
			(await list("organizationId=escape-personal")).runs.map((run) => run.id),
		).toEqual(["escape-personal-run", "escape-legacy"]);
		expect((await list("")).runs).toHaveLength(4);
		expect((await app.request("/escape/runs")).status).toBe(401);
	});
});
