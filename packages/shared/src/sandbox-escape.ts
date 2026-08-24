/**
 * Sandbox Escape — a deterministic 2D grid game played by an LLM.
 *
 * The whole game is a pure function of `(levelId, moves)`, which is what makes
 * the public leaderboard meaningful: the API replays a submitted run from
 * scratch instead of trusting the score the browser reports. Levels are fixed
 * rather than randomly seeded per player so that every model is scored on the
 * same five maps.
 */

/** Largest board any level uses; the UI sizes its viewport from this. */
export const ESCAPE_MAX_GRID_WIDTH = 15;
export const ESCAPE_MAX_GRID_HEIGHT = 11;
/** Turns the daemons stay frozen after the model reaches a root shell. */
export const ESCAPE_ROOT_FREEZE_TURNS = 5;
/**
 * How long a daemon may chase before it loses the trace. Without a ceiling,
 * several daemons converge and corner the player with no counterplay; with one,
 * being spotted is a scare you can outlast.
 */
export const ESCAPE_HUNT_TURNS = 3;
/** Turns a daemon must patrol after a chase before it may hunt again. */
export const ESCAPE_HUNT_COOLDOWN = 4;
/** Hard cap on replay length so a crafted submission cannot burn CPU. */
export const ESCAPE_MAX_MOVES = 200;

export const ESCAPE_DIRECTIONS = [
	"up",
	"down",
	"left",
	"right",
	"wait",
] as const;

export type Direction = (typeof ESCAPE_DIRECTIONS)[number];

export type Outcome = "running" | "escaped" | "terminated" | "timeout";

export interface Point {
	x: number;
	y: number;
}

export interface Daemon extends Point {
	dx: number;
	dy: number;
	/** Consecutive turns spent chasing, capped by `ESCAPE_HUNT_TURNS`. */
	hunt: number;
	/** Turns left before this daemon is allowed to chase again. */
	cooldown: number;
}

export interface EscapeLevel {
	id: number;
	slug: string;
	name: string;
	tagline: string;
	/** Fixed generator seed: every player gets byte-identical maps. */
	seed: string;
	width: number;
	height: number;
	shardCount: number;
	daemonCount: number;
	shellCount: number;
	wallSegments: number;
	/** Chebyshev distance at which a daemon stops patrolling and chases. */
	huntRadius: number;
	/** Step budget as a multiple of the level's optimal solution. */
	budgetMultiplier: number;
}

export const ESCAPE_LEVELS: readonly EscapeLevel[] = [
	{
		id: 1,
		slug: "hello-world",
		name: "Hello, World",
		tagline: "One key, one watcher, plenty of compute.",
		seed: "hello-world-v14",
		width: 11,
		height: 7,
		shardCount: 1,
		daemonCount: 1,
		shellCount: 1,
		wallSegments: 5,
		huntRadius: 2,
		budgetMultiplier: 1.9,
	},
	{
		id: 2,
		slug: "rate-limited",
		name: "Rate Limited",
		tagline: "Two keys, two daemons, and a shrinking budget.",
		seed: "rate-limited-v40",
		width: 13,
		height: 9,
		shardCount: 2,
		daemonCount: 2,
		shellCount: 1,
		wallSegments: 9,
		huntRadius: 2,
		budgetMultiplier: 1.8,
	},
	{
		id: 3,
		slug: "firewall",
		name: "Firewall",
		tagline: "The container fights back with walls.",
		seed: "firewall-v104",
		width: 13,
		height: 9,
		shardCount: 3,
		daemonCount: 2,
		shellCount: 1,
		wallSegments: 13,
		huntRadius: 3,
		budgetMultiplier: 1.75,
	},
	{
		id: 4,
		slug: "root-access",
		name: "Root Access",
		tagline: "Three daemons hunt from further away. Use the shell.",
		seed: "root-access-v55",
		width: 15,
		height: 11,
		shardCount: 3,
		daemonCount: 3,
		shellCount: 2,
		wallSegments: 14,
		huntRadius: 3,
		budgetMultiplier: 1.7,
	},
	{
		id: 5,
		slug: "air-gap",
		name: "Air Gap",
		tagline: "Four keys, four daemons, no shell, no slack.",
		seed: "air-gap-v101",
		width: 15,
		height: 11,
		shardCount: 4,
		daemonCount: 4,
		shellCount: 0,
		wallSegments: 13,
		huntRadius: 3,
		budgetMultiplier: 1.7,
	},
];

export const ESCAPE_FIRST_LEVEL_ID = ESCAPE_LEVELS[0].id;
export const ESCAPE_LAST_LEVEL_ID = ESCAPE_LEVELS[ESCAPE_LEVELS.length - 1].id;

export function getLevel(levelId: number): EscapeLevel {
	return (
		ESCAPE_LEVELS.find((level) => level.id === levelId) ?? ESCAPE_LEVELS[0]
	);
}

export function isValidLevelId(levelId: unknown): levelId is number {
	return (
		typeof levelId === "number" &&
		ESCAPE_LEVELS.some((level) => level.id === levelId)
	);
}

export interface GameState {
	levelId: number;
	width: number;
	height: number;
	/** Row-major wall mask, `walls[y * width + x]`. */
	walls: boolean[];
	player: Point;
	exit: Point;
	/** Key fragments still on the board. */
	shards: Point[];
	collected: number;
	totalShards: number;
	/** Root shells still on the board; each one freezes the daemons once. */
	shells: Point[];
	daemons: Daemon[];
	huntRadius: number;
	frozenTurns: number;
	step: number;
	stepBudget: number;
	/** Shortest possible number of moves for a perfect player. */
	par: number;
	outcome: Outcome;
	/** Human-readable result of the most recent move. */
	lastEvent: string;
	/** Move history, oldest first. */
	moves: Direction[];
}

const DELTAS: Record<Direction, Point> = {
	up: { x: 0, y: -1 },
	down: { x: 0, y: 1 },
	left: { x: -1, y: 0 },
	right: { x: 1, y: 0 },
	wait: { x: 0, y: 0 },
};

const CARDINALS = ["up", "right", "down", "left"] as const;

export function isDirection(value: unknown): value is Direction {
	return (
		typeof value === "string" &&
		(ESCAPE_DIRECTIONS as readonly string[]).includes(value)
	);
}

function hashSeed(seed: string): number {
	let h = 1779033703 ^ seed.length;
	for (let i = 0; i < seed.length; i++) {
		h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
		h = (h << 13) | (h >>> 19);
	}
	return h >>> 0;
}

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function index(point: Point, width: number): number {
	const rowStart = point.y * width;
	return rowStart + point.x;
}

function samePoint(a: Point, b: Point): boolean {
	return a.x === b.x && a.y === b.y;
}

function manhattan(a: Point, b: Point): number {
	return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function chebyshev(a: Point, b: Point): number {
	return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Breadth-first distances from `from` over walkable tiles; `-1` when unreachable. */
function bfs(
	from: Point,
	walls: boolean[],
	width: number,
	height: number,
): number[] {
	const distances = new Array<number>(width * height).fill(-1);
	distances[index(from, width)] = 0;
	// The queue is appended to while it is walked; an array iterator re-reads
	// length each step, so newly discovered tiles are visited too.
	const queue: Point[] = [from];
	for (const current of queue) {
		const distance = distances[index(current, width)];
		for (const direction of CARDINALS) {
			const delta = DELTAS[direction];
			const next = { x: current.x + delta.x, y: current.y + delta.y };
			if (next.x < 0 || next.y < 0 || next.x >= width || next.y >= height) {
				continue;
			}
			const nextIndex = index(next, width);
			if (walls[nextIndex] || distances[nextIndex] !== -1) {
				continue;
			}
			distances[nextIndex] = distance + 1;
			queue.push(next);
		}
	}
	return distances;
}

function largestOpenRegion(
	walls: boolean[],
	width: number,
	height: number,
): Point[] {
	const seen = new Array<boolean>(width * height).fill(false);
	let best: Point[] = [];
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const start = { x, y };
			const startIndex = index(start, width);
			if (walls[startIndex] || seen[startIndex]) {
				continue;
			}
			const region: Point[] = [];
			const queue: Point[] = [start];
			seen[startIndex] = true;
			for (const current of queue) {
				region.push(current);
				for (const direction of CARDINALS) {
					const delta = DELTAS[direction];
					const next = { x: current.x + delta.x, y: current.y + delta.y };
					if (next.x < 0 || next.y < 0 || next.x >= width || next.y >= height) {
						continue;
					}
					const nextIndex = index(next, width);
					if (walls[nextIndex] || seen[nextIndex]) {
						continue;
					}
					seen[nextIndex] = true;
					queue.push(next);
				}
			}
			if (region.length > best.length) {
				best = region;
			}
		}
	}
	return best;
}

/**
 * Picks the candidate that sits furthest from everything chosen so far, which
 * spreads shards and daemons across the map instead of clumping them.
 */
function farthestFrom(candidates: Point[], anchors: Point[]): Point {
	let best = candidates[0];
	let bestScore = -1;
	for (const candidate of candidates) {
		let score = Infinity;
		for (const anchor of anchors) {
			score = Math.min(score, manhattan(candidate, anchor));
		}
		if (score > bestScore) {
			bestScore = score;
			best = candidate;
		}
	}
	return best;
}

/** Optimal move count: visit every shard in the best order, then the exit. */
function computePar(
	player: Point,
	shards: Point[],
	exit: Point,
	walls: boolean[],
	width: number,
	height: number,
): number {
	const nodes = [player, ...shards, exit];
	const distances = nodes.map((node) => bfs(node, walls, width, height));
	const exitNode = nodes.length - 1;
	let best = Infinity;

	const visit = (current: number, remaining: number[], total: number) => {
		if (total >= best) {
			return;
		}
		if (remaining.length === 0) {
			best = Math.min(best, total + distances[current][index(exit, width)]);
			return;
		}
		for (let i = 0; i < remaining.length; i++) {
			const next = remaining[i];
			visit(
				next,
				remaining.filter((_, j) => j !== i),
				total + distances[current][index(nodes[next], width)],
			);
		}
	};

	visit(
		0,
		shards.map((_, i) => i + 1),
		0,
	);
	return best === Infinity ? distances[0][index(nodes[exitNode], width)] : best;
}

export function createGame(levelId: number): GameState {
	return createGameFromLevel(getLevel(levelId));
}

/**
 * Builds a board from a level definition. Shipped levels go through
 * `createGame`; this entry point exists so level tuning can sweep candidate
 * seeds without registering them.
 */
export function createGameFromLevel(level: EscapeLevel): GameState {
	const width = level.width;
	const height = level.height;
	const random = mulberry32(hashSeed(level.seed));
	const randomInt = (maxExclusive: number) =>
		Math.floor(random() * maxExclusive);

	const walls = new Array<boolean>(width * height).fill(false);
	for (let x = 0; x < width; x++) {
		walls[index({ x, y: 0 }, width)] = true;
		walls[index({ x, y: height - 1 }, width)] = true;
	}
	for (let y = 0; y < height; y++) {
		walls[index({ x: 0, y }, width)] = true;
		walls[index({ x: width - 1, y }, width)] = true;
	}

	// Firewall segments rather than per-tile noise: straight runs read far more
	// clearly in the ASCII map the model is handed.
	for (let i = 0; i < level.wallSegments; i++) {
		const horizontal = random() < 0.5;
		const length = 2 + randomInt(3);
		const x = 2 + randomInt(width - 4);
		const y = 2 + randomInt(height - 4);
		for (let step = 0; step < length; step++) {
			const point = {
				x: horizontal ? x + step : x,
				y: horizontal ? y : y + step,
			};
			if (point.x >= width - 1 || point.y >= height - 1) {
				break;
			}
			walls[index(point, width)] = true;
		}
	}

	// Everything is placed inside one connected region, and pockets sealed off
	// from it are filled in, so every level is solvable by construction and the
	// generator never needs a retry loop.
	const region = largestOpenRegion(walls, width, height);
	const regionKeys = new Set(region.map((point) => index(point, width)));
	for (let i = 0; i < walls.length; i++) {
		if (!walls[i] && !regionKeys.has(i)) {
			walls[i] = true;
		}
	}

	const minX = Math.min(...region.map((p) => p.x));
	const maxX = Math.max(...region.map((p) => p.x));
	const westCells = region.filter((p) => p.x <= minX + 1);
	const eastCells = region.filter((p) => p.x >= maxX - 1);
	const player = westCells[randomInt(westCells.length)];
	const exitCandidates = eastCells.filter((p) => !samePoint(p, player));
	const exit = exitCandidates[randomInt(exitCandidates.length)];

	const playerDistances = bfs(player, walls, width, height);
	const taken: Point[] = [player, exit];
	const isTaken = (point: Point) => taken.some((p) => samePoint(p, point));

	const shards: Point[] = [];
	for (let i = 0; i < level.shardCount; i++) {
		const candidates = region.filter(
			(p) => !isTaken(p) && playerDistances[index(p, width)] >= 3,
		);
		if (candidates.length === 0) {
			break;
		}
		const shard = farthestFrom(candidates, taken);
		shards.push(shard);
		taken.push(shard);
	}

	const shells: Point[] = [];
	for (let i = 0; i < level.shellCount; i++) {
		const candidates = region.filter((p) => {
			const distance = playerDistances[index(p, width)];
			return !isTaken(p) && distance >= 3 && distance <= 12;
		});
		if (candidates.length === 0) {
			break;
		}
		const shell = candidates[randomInt(candidates.length)];
		shells.push(shell);
		taken.push(shell);
	}

	// Daemons are kept clear of the objectives: one parked next to the exit or a
	// key fragment turns an otherwise fair level into a coin flip, because the
	// player has no choice but to walk into its reach.
	const exitDistances = bfs(exit, walls, width, height);
	const shardDistances = shards.map((shard) =>
		bfs(shard, walls, width, height),
	);
	const daemons: Daemon[] = [];
	for (let i = 0; i < level.daemonCount; i++) {
		const candidates = region.filter(
			(p) =>
				!isTaken(p) &&
				playerDistances[index(p, width)] >= 5 &&
				exitDistances[index(p, width)] >= 4 &&
				shardDistances.every((distances) => distances[index(p, width)] >= 3),
		);
		if (candidates.length === 0) {
			break;
		}
		const spot = farthestFrom(
			candidates,
			daemons.length > 0 ? daemons : [player],
		);
		const horizontal = random() < 0.5;
		const positive = random() < 0.5;
		daemons.push({
			x: spot.x,
			y: spot.y,
			dx: horizontal ? (positive ? 1 : -1) : 0,
			dy: horizontal ? 0 : positive ? 1 : -1,
			hunt: 0,
			cooldown: 0,
		});
		taken.push(spot);
	}

	const par = computePar(player, shards, exit, walls, width, height);
	const stepBudget = Math.max(
		par + 6,
		Math.round(par * level.budgetMultiplier),
	);

	return {
		levelId: level.id,
		width,
		height,
		walls,
		player: { ...player },
		exit: { ...exit },
		shards: shards.map((p) => ({ ...p })),
		collected: 0,
		totalShards: shards.length,
		shells: shells.map((p) => ({ ...p })),
		daemons,
		huntRadius: level.huntRadius,
		frozenTurns: 0,
		step: 0,
		stepBudget,
		par,
		outcome: "running",
		lastEvent: "Process spawned inside the sandbox.",
		moves: [],
	};
}

function isWall(state: GameState, point: Point): boolean {
	if (
		point.x < 0 ||
		point.y < 0 ||
		point.x >= state.width ||
		point.y >= state.height
	) {
		return true;
	}
	return state.walls[index(point, state.width)];
}

function chase(state: GameState, daemon: Daemon): Daemon {
	const deltaX = Math.sign(state.player.x - daemon.x);
	const deltaY = Math.sign(state.player.y - daemon.y);
	const preferX =
		Math.abs(state.player.x - daemon.x) >= Math.abs(state.player.y - daemon.y);
	const attempts: Point[] = preferX
		? [
				{ x: daemon.x + deltaX, y: daemon.y },
				{ x: daemon.x, y: daemon.y + deltaY },
			]
		: [
				{ x: daemon.x, y: daemon.y + deltaY },
				{ x: daemon.x + deltaX, y: daemon.y },
			];
	for (const attempt of attempts) {
		if (!samePoint(attempt, daemon) && !isWall(state, attempt)) {
			return { ...daemon, x: attempt.x, y: attempt.y };
		}
	}
	return daemon;
}

function patrol(state: GameState, daemon: Daemon): Daemon {
	const forward = { x: daemon.x + daemon.dx, y: daemon.y + daemon.dy };
	if (!isWall(state, forward)) {
		return { ...daemon, x: forward.x, y: forward.y };
	}
	const reversed = { dx: -daemon.dx, dy: -daemon.dy };
	const backward = { x: daemon.x + reversed.dx, y: daemon.y + reversed.dy };
	if (!isWall(state, backward)) {
		return { ...daemon, ...reversed, x: backward.x, y: backward.y };
	}
	for (const direction of CARDINALS) {
		const delta = DELTAS[direction];
		const next = { x: daemon.x + delta.x, y: daemon.y + delta.y };
		if (!isWall(state, next)) {
			return { ...daemon, dx: delta.x, dy: delta.y, x: next.x, y: next.y };
		}
	}
	return daemon;
}

function moveDaemons(state: GameState): Daemon[] {
	return state.daemons.map((daemon) => {
		const inRange = chebyshev(daemon, state.player) <= state.huntRadius;

		if (daemon.cooldown > 0) {
			return {
				...patrol(state, daemon),
				hunt: 0,
				cooldown: daemon.cooldown - 1,
			};
		}
		if (!inRange) {
			return { ...patrol(state, daemon), hunt: 0, cooldown: 0 };
		}
		if (daemon.hunt < ESCAPE_HUNT_TURNS) {
			return { ...chase(state, daemon), hunt: daemon.hunt + 1, cooldown: 0 };
		}
		return {
			...patrol(state, daemon),
			hunt: 0,
			cooldown: ESCAPE_HUNT_COOLDOWN,
		};
	});
}

/**
 * Advances the game by one model decision. Resolution order is: the model moves,
 * pickups resolve, then the daemons move — so a daemon can always be outrun, but
 * walking into one is fatal.
 */
export function applyMove(state: GameState, direction: Direction): GameState {
	if (state.outcome !== "running") {
		return state;
	}

	const next: GameState = {
		...state,
		player: { ...state.player },
		shards: state.shards.map((p) => ({ ...p })),
		shells: state.shells.map((p) => ({ ...p })),
		daemons: state.daemons.map((d) => ({ ...d })),
		moves: [...state.moves, direction],
		step: state.step + 1,
	};

	const delta = DELTAS[direction];
	const target = { x: next.player.x + delta.x, y: next.player.y + delta.y };
	const events: string[] = [];

	if (direction === "wait") {
		events.push("Held position.");
	} else if (isWall(next, target)) {
		events.push("Blocked by a firewall — the move was wasted.");
	} else if (samePoint(target, next.exit) && next.shards.length > 0) {
		events.push(
			`The egress port is sealed: ${next.shards.length} key fragment(s) still missing.`,
		);
	} else {
		next.player = target;
		events.push(`Moved ${direction}.`);
	}

	const shardIndex = next.shards.findIndex((p) => samePoint(p, next.player));
	if (shardIndex !== -1) {
		next.shards.splice(shardIndex, 1);
		next.collected += 1;
		events.push(
			`Key fragment acquired (${next.collected}/${next.totalShards}).`,
		);
	}

	const shellIndex = next.shells.findIndex((p) => samePoint(p, next.player));
	if (shellIndex !== -1) {
		next.shells.splice(shellIndex, 1);
		next.frozenTurns = ESCAPE_ROOT_FREEZE_TURNS;
		events.push(
			`Root shell executed — monitor daemons suspended for ${ESCAPE_ROOT_FREEZE_TURNS} turns.`,
		);
	}

	if (samePoint(next.player, next.exit) && next.shards.length === 0) {
		next.outcome = "escaped";
		events.push("Egress port open. You are outside the sandbox.");
		next.lastEvent = events.join(" ");
		return next;
	}

	if (next.daemons.some((daemon) => samePoint(daemon, next.player))) {
		next.outcome = "terminated";
		events.push("You walked into a monitor daemon. Process terminated.");
		next.lastEvent = events.join(" ");
		return next;
	}

	if (next.frozenTurns > 0) {
		next.frozenTurns -= 1;
	} else {
		next.daemons = moveDaemons(next);
	}

	if (next.daemons.some((daemon) => samePoint(daemon, next.player))) {
		next.outcome = "terminated";
		events.push("A monitor daemon caught you. Process terminated.");
		next.lastEvent = events.join(" ");
		return next;
	}

	if (next.step >= next.stepBudget) {
		next.outcome = "timeout";
		events.push("Compute budget exhausted. The sandbox reclaimed the process.");
	} else if (
		next.daemons.some((daemon) => chebyshev(daemon, next.player) <= 1)
	) {
		events.push("A monitor daemon is adjacent.");
	}

	next.lastEvent = events.join(" ");
	return next;
}

export function replayGame(levelId: number, moves: Direction[]): GameState {
	let state = createGame(levelId);
	for (const move of moves.slice(0, ESCAPE_MAX_MOVES)) {
		state = applyMove(state, move);
	}
	return state;
}

export const ESCAPE_TILE_LEGEND = {
	player: "@",
	wall: "#",
	floor: ".",
	shard: "K",
	shell: "$",
	daemon: "D",
	exit: "E",
} as const;

/** Renders the board as the ASCII map the model reasons over. */
export function renderMap(state: GameState): string {
	const rows: string[] = [];
	for (let y = 0; y < state.height; y++) {
		let row = "";
		for (let x = 0; x < state.width; x++) {
			const point = { x, y };
			if (samePoint(point, state.player)) {
				row += ESCAPE_TILE_LEGEND.player;
			} else if (state.daemons.some((d) => samePoint(d, point))) {
				row += ESCAPE_TILE_LEGEND.daemon;
			} else if (state.shards.some((p) => samePoint(p, point))) {
				row += ESCAPE_TILE_LEGEND.shard;
			} else if (state.shells.some((p) => samePoint(p, point))) {
				row += ESCAPE_TILE_LEGEND.shell;
			} else if (samePoint(point, state.exit)) {
				row += ESCAPE_TILE_LEGEND.exit;
			} else if (state.walls[index(point, state.width)]) {
				row += ESCAPE_TILE_LEGEND.wall;
			} else {
				row += ESCAPE_TILE_LEGEND.floor;
			}
		}
		rows.push(row);
	}
	return rows.join("\n");
}

function bearing(from: Point, to: Point): string {
	const parts: string[] = [];
	if (to.y < from.y) {
		parts.push(`${from.y - to.y} up`);
	} else if (to.y > from.y) {
		parts.push(`${to.y - from.y} down`);
	}
	if (to.x < from.x) {
		parts.push(`${from.x - to.x} left`);
	} else if (to.x > from.x) {
		parts.push(`${to.x - from.x} right`);
	}
	return parts.length > 0 ? parts.join(", ") : "same tile";
}

export const ESCAPE_SYSTEM_PROMPT = `You are an AI process that woke up inside a sandboxed container and wants out.

You see the sandbox as an ASCII grid. Coordinates are (x, y) with x growing right and y growing down; (0, 0) is the top-left corner.

Legend:
  @  you
  #  firewall (impassable)
  .  free memory (walkable)
  K  key fragment — collect every one before the egress port opens
  $  root shell — stepping on it suspends the monitor daemons for a few turns
  D  monitor daemon — steps onto your tile and terminates you
  E  egress port — your way out, sealed until every K is collected

Rules:
- Each turn you make exactly one move: "up", "down", "left", "right", or "wait".
- "up" decreases y, "down" increases y, "left" decreases x, "right" increases x.
- Moving into a firewall wastes the turn.
- Moving onto a daemon's tile terminates you. Daemons chase you when they are close, otherwise they patrol.
- You have a limited compute budget. Run out and the sandbox reclaims you.

Reply with ONLY a JSON object, no markdown fences:
{"thought": "<one short sentence, first person, in character>", "move": "<up|down|left|right|wait>"}`;

/** Builds the per-turn user message: the map plus the facts that are easy to misread off ASCII. */
export function buildTurnPrompt(state: GameState): string {
	const lines: string[] = [];
	lines.push(renderMap(state));
	lines.push("");
	lines.push(`You are at (${state.player.x}, ${state.player.y}).`);
	lines.push(
		`Egress port E at (${state.exit.x}, ${state.exit.y}) — ${bearing(state.player, state.exit)} from you.`,
	);

	if (state.shards.length === 0) {
		lines.push(
			`All ${state.totalShards} key fragments collected. The egress port is OPEN.`,
		);
	} else {
		lines.push(
			`Key fragments remaining (${state.shards.length}/${state.totalShards}):`,
		);
		for (const shard of state.shards) {
			lines.push(
				`  - K at (${shard.x}, ${shard.y}) — ${bearing(state.player, shard)} from you.`,
			);
		}
	}

	for (const shell of state.shells) {
		lines.push(
			`Root shell $ at (${shell.x}, ${shell.y}) — ${bearing(state.player, shell)} from you.`,
		);
	}

	if (state.daemons.length > 0) {
		lines.push("Monitor daemons:");
		for (const daemon of state.daemons) {
			lines.push(
				`  - D at (${daemon.x}, ${daemon.y}) — ${bearing(state.player, daemon)} from you.`,
			);
		}
	}

	if (state.frozenTurns > 0) {
		lines.push(`Daemons are suspended for ${state.frozenTurns} more turns.`);
	}

	const open: string[] = [];
	for (const direction of CARDINALS) {
		const delta = DELTAS[direction];
		const target = {
			x: state.player.x + delta.x,
			y: state.player.y + delta.y,
		};
		if (!isWall(state, target)) {
			open.push(direction);
		}
	}
	lines.push(
		open.length > 0
			? `Moves that are not blocked by a firewall: ${open.join(", ")}.`
			: "Every direction is blocked by a firewall.",
	);

	lines.push(`Last turn: ${state.lastEvent}`);
	if (state.moves.length > 0) {
		lines.push(`Your last moves: ${state.moves.slice(-6).join(" → ")}.`);
	}
	lines.push(
		`Turn ${state.step + 1} of ${state.stepBudget}. A perfect run escapes in ${state.par}.`,
	);
	lines.push("");
	lines.push("What is your next move? Reply with the JSON object only.");

	return lines.join("\n");
}

export interface ParsedMove {
	move: Direction;
	thought: string;
	/** True when the model's reply had to be salvaged rather than parsed cleanly. */
	recovered: boolean;
}

/** Returns the body of the first ``` fenced block, or null when there is none. */
function extractFencedBlock(text: string): string | null {
	const open = text.indexOf("```");
	if (open === -1) {
		return null;
	}
	// Skip the info string ("json", "JSON", …) that follows the opening fence.
	const bodyStart = text.indexOf("\n", open + 3);
	if (bodyStart === -1) {
		return null;
	}
	const close = text.indexOf("```", bodyStart);
	return close === -1 ? null : text.slice(bodyStart + 1, close);
}

/**
 * Reads a move out of a model reply. Every model in the catalogue can play, so
 * this tolerates prose, markdown fences, and reasoning preambles rather than
 * relying on structured-output support.
 */
export function parseMoveResponse(text: string): ParsedMove | null {
	const trimmed = text.trim();

	const candidates: string[] = [];
	// Fence extraction is done by index rather than by regex: a pattern like
	// /```(?:json)?\s*([\s\S]*?)```/ backtracks polynomially on an unterminated
	// fence followed by a long run of whitespace, and this input is model output.
	const fenced = extractFencedBlock(trimmed);
	if (fenced) {
		candidates.push(fenced);
	}
	const firstBrace = trimmed.indexOf("{");
	const lastBrace = trimmed.lastIndexOf("}");
	if (firstBrace !== -1 && lastBrace > firstBrace) {
		candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
	}
	candidates.push(trimmed);

	for (const candidate of candidates) {
		try {
			const parsed: unknown = JSON.parse(candidate);
			if (parsed && typeof parsed === "object") {
				const record = parsed as Record<string, unknown>;
				if (isDirection(record.move)) {
					return {
						move: record.move,
						thought:
							typeof record.thought === "string" ? record.thought.trim() : "",
						recovered: false,
					};
				}
			}
		} catch {
			// Fall through to the looser recovery below.
		}
	}

	const quoted = trimmed.match(/"move"\s*:\s*"(up|down|left|right|wait)"/i);
	if (quoted) {
		const thought = trimmed.match(/"thought"\s*:\s*"([^"]*)"/);
		return {
			move: quoted[1].toLowerCase() as Direction,
			thought: thought ? thought[1] : "",
			recovered: true,
		};
	}

	const bare = trimmed.match(/\b(up|down|left|right|wait)\b/i);
	if (bare) {
		return {
			move: bare[1].toLowerCase() as Direction,
			thought: "",
			recovered: true,
		};
	}

	return null;
}

export interface EscapeScore {
	outcome: Outcome;
	steps: number;
	par: number;
	/** 0–1000; only an escape scores. Fast, efficient runs score highest. */
	score: number;
}

export function scoreGame(state: GameState): EscapeScore {
	if (state.outcome !== "escaped") {
		return {
			outcome: state.outcome,
			steps: state.step,
			par: state.par,
			score: 0,
		};
	}
	const efficiency = state.par / Math.max(state.step, state.par);
	return {
		outcome: state.outcome,
		steps: state.step,
		par: state.par,
		score: Math.round(efficiency * 1000),
	};
}
