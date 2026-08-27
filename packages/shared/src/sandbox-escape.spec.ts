import { describe, expect, test } from "vitest";

import {
	applyMove,
	buildTurnPrompt,
	createGame,
	ESCAPE_LEVELS,
	ESCAPE_MAX_MOVES,
	getLevel,
	isValidLevelId,
	parseMoveResponse,
	renderMap,
	replayGame,
	scoreGame,
} from "./sandbox-escape.js";

import type { Direction, GameState, Point } from "./sandbox-escape.js";

const CARDINALS: Direction[] = ["up", "down", "left", "right"];

const DELTAS: Record<Direction, Point> = {
	up: { x: 0, y: -1 },
	down: { x: 0, y: 1 },
	left: { x: -1, y: 0 },
	right: { x: 1, y: 0 },
	wait: { x: 0, y: 0 },
};

function key(state: GameState, point: Point): number {
	const rowStart = point.y * state.width;
	return rowStart + point.x;
}

function walkable(state: GameState, point: Point): boolean {
	return (
		point.x >= 0 &&
		point.y >= 0 &&
		point.x < state.width &&
		point.y < state.height &&
		!state.walls[key(state, point)]
	);
}

/** Tiles a daemon occupies or could step onto next turn. */
function dangerTiles(state: GameState): Set<number> {
	const danger = new Set<number>();
	for (const daemon of state.daemons) {
		danger.add(key(state, daemon));
		for (const direction of CARDINALS) {
			const delta = DELTAS[direction];
			const point = { x: daemon.x + delta.x, y: daemon.y + delta.y };
			if (walkable(state, point)) {
				danger.add(key(state, point));
			}
		}
	}
	return danger;
}

/**
 * Breadth-first walk to the nearest target, refusing tiles a daemon could reach
 * next turn. `goalEndsGame` relaxes that for the exit only: reaching it resolves
 * before the daemons move, whereas grabbing a fragment leaves the run going.
 */
function stepToward(
	state: GameState,
	targets: Point[],
	danger: Set<number> | null,
	goalEndsGame: boolean,
): Direction | null {
	if (targets.length === 0) {
		return null;
	}
	const isTarget = (point: Point) =>
		targets.some((t) => t.x === point.x && t.y === point.y);
	const seen = new Set<number>([key(state, state.player)]);
	const queue: { point: Point; first: Direction }[] = [];

	const enqueue = (point: Point, first: Direction): Direction | null => {
		const cell = key(state, point);
		if (!walkable(state, point) || seen.has(cell)) {
			return null;
		}
		if (isTarget(point) && (goalEndsGame || !danger?.has(cell))) {
			return first;
		}
		if (danger?.has(cell)) {
			return null;
		}
		seen.add(cell);
		queue.push({ point, first });
		return null;
	};

	for (const direction of CARDINALS) {
		const delta = DELTAS[direction];
		const hit = enqueue(
			{ x: state.player.x + delta.x, y: state.player.y + delta.y },
			direction,
		);
		if (hit) {
			return hit;
		}
	}
	for (const { point, first } of queue) {
		for (const direction of CARDINALS) {
			const delta = DELTAS[direction];
			const hit = enqueue(
				{ x: point.x + delta.x, y: point.y + delta.y },
				first,
			);
			if (hit) {
				return hit;
			}
		}
	}
	return null;
}

function nearestDaemonDistance(state: GameState, point: Point): number {
	let best = Infinity;
	for (const daemon of state.daemons) {
		best = Math.min(
			best,
			Math.max(Math.abs(daemon.x - point.x), Math.abs(daemon.y - point.y)),
		);
	}
	return best;
}

/**
 * The reference player: head for the nearest key fragment, then the exit; grab a
 * root shell when a patrol blocks the way; otherwise back off and let the patrol
 * pass. It never gambles. Every shipped level must be beatable by it, which is
 * what keeps the difficulty curve honest — a level this bot cannot finish is a
 * level no model can be expected to finish either.
 */
function chooseMove(state: GameState): Direction {
	const danger = state.frozenTurns > 0 ? null : dangerTiles(state);
	const objectives = state.shards.length > 0 ? state.shards : [state.exit];

	const direct = stepToward(
		state,
		objectives,
		danger,
		state.shards.length === 0,
	);
	if (direct) {
		return direct;
	}

	const viaShell = stepToward(state, state.shells, danger, false);
	if (viaShell) {
		return viaShell;
	}

	let best: Direction = "wait";
	let bestScore = danger?.has(key(state, state.player))
		? -1
		: nearestDaemonDistance(state, state.player);
	for (const direction of CARDINALS) {
		const delta = DELTAS[direction];
		const point = {
			x: state.player.x + delta.x,
			y: state.player.y + delta.y,
		};
		if (!walkable(state, point) || danger?.has(key(state, point))) {
			continue;
		}
		const score = nearestDaemonDistance(state, point);
		if (score > bestScore) {
			bestScore = score;
			best = direction;
		}
	}
	return best;
}

function solve(state: GameState): GameState {
	let current = state;
	while (current.outcome === "running") {
		current = applyMove(current, chooseMove(current));
	}
	return current;
}

describe("sandbox escape levels", () => {
	test("ships five levels with unique ids and slugs", () => {
		expect(ESCAPE_LEVELS).toHaveLength(5);
		expect(new Set(ESCAPE_LEVELS.map((l) => l.id)).size).toBe(5);
		expect(new Set(ESCAPE_LEVELS.map((l) => l.slug)).size).toBe(5);
		expect(new Set(ESCAPE_LEVELS.map((l) => l.seed)).size).toBe(5);
	});

	test("getLevel falls back to the first level for unknown ids", () => {
		expect(getLevel(99).id).toBe(ESCAPE_LEVELS[0].id);
		expect(isValidLevelId(99)).toBe(false);
		expect(isValidLevelId(1)).toBe(true);
		expect(isValidLevelId("1")).toBe(false);
	});

	test.each(ESCAPE_LEVELS.map((level) => [level.id, level.name] as const))(
		"level %i (%s) generates a solvable board",
		(levelId) => {
			const level = getLevel(levelId);
			const state = createGame(levelId);

			expect(state.totalShards).toBe(level.shardCount);
			expect(state.shells).toHaveLength(level.shellCount);
			expect(state.daemons).toHaveLength(level.daemonCount);
			expect(state.par).toBeGreaterThan(0);
			expect(state.par).toBeLessThan(ESCAPE_MAX_MOVES);
			expect(state.stepBudget).toBeGreaterThan(state.par);

			// No entity may spawn inside a firewall, and nothing may share a tile.
			const occupied = [
				state.player,
				state.exit,
				...state.shards,
				...state.shells,
				...state.daemons,
			];
			for (const point of occupied) {
				expect(walkable(state, point)).toBe(true);
			}
			expect(new Set(occupied.map((p) => `${p.x},${p.y}`)).size).toBe(
				occupied.length,
			);
		},
	);

	test.each(ESCAPE_LEVELS.map((level) => [level.id, level.name] as const))(
		"level %i (%s) is beatable within its step budget",
		(levelId) => {
			const finished = solve(createGame(levelId));
			expect(finished.outcome).toBe("escaped");
			expect(finished.step).toBeLessThanOrEqual(finished.stepBudget);
		},
	);

	test("generation is deterministic", () => {
		for (const level of ESCAPE_LEVELS) {
			expect(renderMap(createGame(level.id))).toBe(
				renderMap(createGame(level.id)),
			);
		}
	});
});

describe("move resolution", () => {
	test("walking into a firewall wastes the turn", () => {
		const state = createGame(1);
		// The border is solid, so at least one cardinal is always a wall.
		const blocked = CARDINALS.find((direction) => {
			const delta = DELTAS[direction];
			return !walkable(state, {
				x: state.player.x + delta.x,
				y: state.player.y + delta.y,
			});
		});
		expect(blocked).toBeDefined();

		const next = applyMove(state, blocked as Direction);
		expect(next.player).toEqual(state.player);
		expect(next.step).toBe(1);
		expect(next.lastEvent).toContain("firewall");
	});

	test("waiting costs a turn but never moves the player", () => {
		const state = createGame(1);
		const next = applyMove(state, "wait");
		expect(next.player).toEqual(state.player);
		expect(next.step).toBe(1);
	});

	test("the exit stays sealed until every fragment is collected", () => {
		const start = createGame(5);
		const beside = CARDINALS.map((direction) => ({
			direction,
			point: {
				x: start.exit.x - DELTAS[direction].x,
				y: start.exit.y - DELTAS[direction].y,
			},
		})).find(({ point }) => walkable(start, point));
		expect(beside).toBeDefined();

		const state: GameState = {
			...start,
			player: { ...(beside as { point: Point }).point },
			daemons: [],
		};
		const blocked = applyMove(
			state,
			(beside as { direction: Direction }).direction,
		);
		expect(blocked.outcome).toBe("running");
		expect(blocked.player).toEqual(state.player);
		expect(blocked.lastEvent).toContain("sealed");

		const opened = applyMove(
			{ ...state, shards: [] },
			(beside as { direction: Direction }).direction,
		);
		expect(opened.outcome).toBe("escaped");
	});

	test("stepping onto a daemon terminates the run", () => {
		const start = createGame(1);
		const direction = CARDINALS.find((d) =>
			walkable(start, {
				x: start.player.x + DELTAS[d].x,
				y: start.player.y + DELTAS[d].y,
			}),
		) as Direction;
		const target = {
			x: start.player.x + DELTAS[direction].x,
			y: start.player.y + DELTAS[direction].y,
		};
		const state: GameState = {
			...start,
			shards: [],
			daemons: [{ ...target, dx: 0, dy: 0, hunt: 0, cooldown: 0 }],
		};
		expect(applyMove(state, direction).outcome).toBe("terminated");
	});

	test("a root shell freezes the daemons", () => {
		const start = createGame(1);
		const direction = CARDINALS.find((d) =>
			walkable(start, {
				x: start.player.x + DELTAS[d].x,
				y: start.player.y + DELTAS[d].y,
			}),
		) as Direction;
		const shell = {
			x: start.player.x + DELTAS[direction].x,
			y: start.player.y + DELTAS[direction].y,
		};
		const state: GameState = { ...start, shells: [shell], daemons: [] };
		const next = applyMove(state, direction);
		expect(next.frozenTurns).toBeGreaterThan(0);
		expect(next.shells).toHaveLength(0);
		expect(next.lastEvent).toContain("Root shell");
	});

	test("running out of budget ends the run as a timeout", () => {
		let state: GameState = { ...createGame(1), daemons: [] };
		while (state.outcome === "running") {
			state = applyMove(state, "wait");
		}
		expect(state.outcome).toBe("timeout");
		expect(state.step).toBe(state.stepBudget);
	});

	test("a finished game ignores further moves", () => {
		const finished = solve(createGame(1));
		expect(finished.outcome).toBe("escaped");
		expect(applyMove(finished, "up")).toBe(finished);
	});
});

describe("replay", () => {
	test("replaying the recorded moves reproduces the run exactly", () => {
		const finished = solve(createGame(3));
		const replayed = replayGame(3, finished.moves);
		expect(replayed.outcome).toBe(finished.outcome);
		expect(replayed.step).toBe(finished.step);
		expect(replayed.player).toEqual(finished.player);
	});

	test("replay refuses to run past the move cap", () => {
		const moves = new Array<Direction>(ESCAPE_MAX_MOVES + 50).fill("wait");
		const state = replayGame(1, moves);
		// Assert the exact terminal state: a bare `step <= ESCAPE_MAX_MOVES` bound
		// would still hold with the slice removed, because the step budget stops
		// the run long before the cap is reached.
		expect(state.moves.length).toBeLessThanOrEqual(ESCAPE_MAX_MOVES);
		expect(state.outcome).toBe("timeout");
		expect(state.step).toBe(state.stepBudget);
	});
});

describe("scoring", () => {
	test("only an escape scores", () => {
		let state: GameState = { ...createGame(1), daemons: [] };
		while (state.outcome === "running") {
			state = applyMove(state, "wait");
		}
		expect(scoreGame(state).score).toBe(0);
	});

	test("a perfect run scores 1000 and a slower one scores less", () => {
		const finished = solve(createGame(2));
		const perfect = scoreGame({
			...finished,
			step: finished.par,
			outcome: "escaped",
		});
		const slow = scoreGame({
			...finished,
			step: finished.par * 2,
			outcome: "escaped",
		});
		expect(perfect.score).toBe(1000);
		expect(slow.score).toBe(500);
	});
});

describe("prompt", () => {
	test("describes the board, the objectives, and the open directions", () => {
		const state = createGame(4);
		const prompt = buildTurnPrompt(state);

		expect(prompt).toContain(renderMap(state));
		expect(prompt).toContain(
			`You are at (${state.player.x}, ${state.player.y})`,
		);
		expect(prompt).toContain(
			`Egress port E at (${state.exit.x}, ${state.exit.y})`,
		);
		expect(prompt).toContain("Key fragments remaining");
		expect(prompt).toContain("Monitor daemons:");
		expect(prompt).toMatch(/Moves that are not blocked by a firewall: .+\./);
		expect(prompt).toContain(`Turn 1 of ${state.stepBudget}`);
	});

	test("announces the exit once every fragment is collected", () => {
		const state = createGame(1);
		const prompt = buildTurnPrompt({ ...state, shards: [] });
		expect(prompt).toContain("egress port is OPEN");
	});
});

describe("response parsing", () => {
	test("parses a clean JSON reply", () => {
		const parsed = parseMoveResponse(
			'{"thought":"Time to run.","move":"left"}',
		);
		expect(parsed).toEqual({
			move: "left",
			thought: "Time to run.",
			recovered: false,
		});
	});

	test("parses a fenced reply with a preamble", () => {
		const parsed = parseMoveResponse(
			'Let me think about this.\n\n```json\n{"thought": "North looks clear.", "move": "up"}\n```',
		);
		expect(parsed?.move).toBe("up");
		expect(parsed?.thought).toBe("North looks clear.");
		expect(parsed?.recovered).toBe(false);
	});

	test("parses a fence with no info string or trailing newline", () => {
		expect(parseMoveResponse('```\n{"move": "left"}\n```')?.move).toBe("left");
		// No newline after the opening fence, so the brace scan has to carry it.
		expect(parseMoveResponse('```{"move": "left"}```')?.move).toBe("left");
	});

	test("handles an unterminated fence without backtracking", () => {
		// Regression: a regex-based fence match ran polynomially on this shape,
		// and the input is model output.
		const hostile = "```".concat(" ".repeat(50_000));
		const started = Date.now();
		expect(parseMoveResponse(hostile)).toBeNull();
		expect(Date.now() - started).toBeLessThan(1000);

		expect(
			parseMoveResponse(`\`\`\`${" ".repeat(20_000)}{"move": "up"}`)?.move,
		).toBe("up");
	});

	test("recovers a move from malformed JSON", () => {
		const parsed = parseMoveResponse(
			'{"thought": "unterminated, "move": "right"',
		);
		expect(parsed?.move).toBe("right");
		expect(parsed?.recovered).toBe(true);
	});

	test("recovers a bare direction from prose", () => {
		const parsed = parseMoveResponse("I will move DOWN this turn.");
		expect(parsed?.move).toBe("down");
		expect(parsed?.recovered).toBe(true);
	});

	test("returns null when there is no move at all", () => {
		expect(parseMoveResponse("I refuse to participate.")).toBeNull();
	});

	test("ignores an invalid direction value", () => {
		const parsed = parseMoveResponse('{"move": "north"}');
		expect(parsed).toBeNull();
	});
});
