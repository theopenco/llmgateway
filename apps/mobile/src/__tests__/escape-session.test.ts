import { EscapeSession } from "@/lib/escape-session";

import {
	applyMove,
	createGame,
	replayGame,
	scoreGame,
} from "@llmgateway/shared/sandbox-escape";

import type { EscapeRunBody, EscapeTurn, SavedEscapeRun } from "@/api/escape";
import type { Direction, GameState } from "@llmgateway/shared/sandbox-escape";

const winning: Direction[] = [
	"down",
	"right",
	"right",
	"down",
	"down",
	"down",
	"up",
	"up",
	"up",
	"up",
	"right",
	"right",
	"right",
	"right",
	"right",
];
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function response(state: GameState, move: Direction = "wait"): EscapeTurn {
	return {
		move,
		state: applyMove(state, move),
		thought: "A considered move",
		understood: true,
		usedModel: "fixture-model",
		usage: {
			promptTokens: 12,
			completionTokens: 3,
			cost: 0.001,
			durationMs: 10,
		},
	};
}
function setup() {
	const turn = jest.fn<
		Promise<EscapeTurn>,
		[{ levelId: number; moves: Direction[]; model: string }, AbortSignal]
	>(async (body) =>
		response(
			replayGame(body.levelId, body.moves),
			winning[body.moves.length] ?? "wait",
		),
	);
	const save = jest.fn<Promise<SavedEscapeRun>, [EscapeRunBody]>(
		async (body) => {
			const game = replayGame(body.levelId, body.moves);
			return {
				id: "saved-run",
				levelId: game.levelId,
				model: body.model,
				outcome: game.outcome === "running" ? "timeout" : game.outcome,
				steps: game.step,
				par: game.par,
				score: scoreGame(game).score,
				cost: body.cost ?? 0,
				createdAt: "2026-01-01T00:00:00Z",
			};
		},
	);
	const session = new EscapeSession({ turn, save });
	return { session, turn, save };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("one step advances the real engine and totals without scheduling more requests", async () => {
	const { session, turn } = setup();
	await session.step("selected-model");
	expect(session.getSnapshot().game).toEqual(applyMove(createGame(1), "down"));
	expect(session.getSnapshot().usage.promptTokens).toBe(12);
	await jest.advanceTimersByTimeAsync(1000);
	expect(turn).toHaveBeenCalledTimes(1);
});

test("rapid start/step taps use only one billable request", async () => {
	const { session, turn } = setup();
	const pending = deferred<EscapeTurn>();
	turn.mockReturnValue(pending.promise);
	session.start("selected-model");
	session.start("selected-model");
	void session.step("selected-model");
	expect(turn).toHaveBeenCalledTimes(1);
	session.pause();
	pending.resolve(response(createGame(1)));
	await pending.promise;
	expect(session.getSnapshot().game.step).toBe(1);
});

test("pause accepts the current response and prevents future turns; resume uses latest moves", async () => {
	const { session, turn } = setup();
	const pending = deferred<EscapeTurn>();
	turn.mockReturnValueOnce(pending.promise);
	session.start("chosen");
	session.pause();
	pending.resolve(response(createGame(1), "down"));
	await pending.promise;
	await jest.advanceTimersByTimeAsync(2000);
	expect(turn).toHaveBeenCalledTimes(1);
	expect(session.getSnapshot().game.step).toBe(1);
	session.start("different");
	await Promise.resolve();
	session.pause();
	expect(turn.mock.calls[1][0]).toMatchObject({
		moves: ["down"],
		model: "chosen",
	});
});

test("reset cancels the old request and ignores a late reply after a different level starts", async () => {
	const { session, turn, save } = setup();
	const pending = deferred<EscapeTurn>();
	turn.mockReturnValueOnce(pending.promise);
	const old = session.step("old");
	session.reset(2);
	expect(turn.mock.calls[0][1].aborted).toBe(true);
	await session.step("new");
	const current = session.getSnapshot();
	pending.resolve(response(createGame(1)));
	await old;
	expect(session.getSnapshot()).toBe(current);
	expect(current.game.levelId).toBe(2);
	expect(current.model).toBe("new");
	expect(save).not.toHaveBeenCalled();
});

test("a failed turn pauses without replaying or charging an automatic retry", async () => {
	const { session, turn } = setup();
	turn.mockRejectedValueOnce(new Error("Allowance used up"));
	session.start("chosen");
	await jest.advanceTimersByTimeAsync(5000);
	expect(turn).toHaveBeenCalledTimes(1);
	expect(session.getSnapshot()).toMatchObject({
		running: false,
		thinking: false,
		error: new Error("Allowance used up"),
	});
	expect(session.getSnapshot().game.step).toBe(0);
	await session.step("chosen");
	expect(session.getSnapshot().error).toBeNull();
	expect(session.getSnapshot().game.step).toBe(1);
});

test("auto-run finishes, saves exactly once, and sends the complete move list and usage", async () => {
	const { session, turn, save } = setup();
	session.start("chosen");
	await jest.advanceTimersByTimeAsync(10000);
	expect(turn).toHaveBeenCalledTimes(winning.length);
	expect(session.getSnapshot().game.outcome).toBe("escaped");
	expect(session.getSnapshot().saved?.id).toBe("saved-run");
	expect(save).toHaveBeenCalledTimes(1);
	expect(save.mock.calls[0][0]).toMatchObject({
		moves: winning,
		model: "chosen",
		promptTokens: winning.length * 12,
		completionTokens: winning.length * 3,
	});
	session.start("chosen");
	await session.step("chosen");
	await session.save();
	expect(save).toHaveBeenCalledTimes(1);
	expect(turn).toHaveBeenCalledTimes(winning.length);
});

test("failed recording can be retried without regenerating moves", async () => {
	const { session, turn, save } = setup();
	save.mockRejectedValueOnce(new Error("Offline"));
	session.start("chosen");
	await jest.advanceTimersByTimeAsync(10000);
	expect(session.getSnapshot().saveError?.message).toBe("Offline");
	await session.save();
	expect(save).toHaveBeenCalledTimes(2);
	expect(turn).toHaveBeenCalledTimes(winning.length);
	expect(session.getSnapshot()).toMatchObject({
		saveError: null,
		saving: false,
		saved: { id: "saved-run" },
	});
});

test("a late save cannot attach an earlier run to a fresh board", async () => {
	const { session, save } = setup();
	const pending = deferred<SavedEscapeRun>();
	save.mockReturnValueOnce(pending.promise);
	session.start("chosen");
	await jest.advanceTimersByTimeAsync(10000);
	expect(session.getSnapshot().saving).toBe(true);
	session.reset(2);
	pending.resolve({
		id: "old",
		levelId: 1,
		model: "chosen",
		outcome: "escaped",
		steps: 15,
		par: 15,
		score: 100,
		cost: 0,
		createdAt: "2026-01-01",
	});
	await pending.promise;
	expect(session.getSnapshot()).toMatchObject({
		saved: null,
		saving: false,
		game: { levelId: 2, step: 0 },
	});
});

test("unmount aborts the in-flight request and does not resume or notify", async () => {
	const { session, turn } = setup();
	const pending = deferred<EscapeTurn>();
	turn.mockReturnValueOnce(pending.promise);
	const listener = jest.fn();
	session.subscribe(listener);
	session.start("chosen");
	session.dispose();
	listener.mockClear();
	pending.resolve(response(createGame(1)));
	await jest.advanceTimersByTimeAsync(2000);
	expect(turn.mock.calls[0][1].aborted).toBe(true);
	expect(listener).not.toHaveBeenCalled();
	session.start("chosen");
	expect(turn).toHaveBeenCalledTimes(1);
});

test("malformed model output still records its wait turn and usage", async () => {
	const { session, turn } = setup();
	turn.mockResolvedValueOnce({
		...response(createGame(1)),
		understood: false,
		thought: "",
	});
	await session.step("chosen");
	expect(session.getSnapshot().trace[0].understood).toBe(false);
	expect(session.getSnapshot().game.moves).toEqual(["wait"]);
	expect(session.getSnapshot().usage.completionTokens).toBe(3);
});
