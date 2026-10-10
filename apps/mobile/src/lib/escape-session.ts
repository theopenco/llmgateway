import {
	createGame,
	ESCAPE_FIRST_LEVEL_ID,
} from "@llmgateway/shared/sandbox-escape";

import type { EscapeRunBody, EscapeTurn, SavedEscapeRun } from "@/api/escape";
import type { GameState } from "@llmgateway/shared/sandbox-escape";

interface TraceEntry extends EscapeTurn {
	id: number;
}
interface Snapshot {
	game: GameState;
	trace: TraceEntry[];
	running: boolean;
	thinking: boolean;
	model: string | null;
	usage: EscapeTurn["usage"];
	error: Error | null;
	saving: boolean;
	saveError: Error | null;
	saved: SavedEscapeRun | null;
}
interface Dependencies {
	turn: (
		body: { levelId: number; moves: GameState["moves"]; model: string },
		signal: AbortSignal,
	) => Promise<EscapeTurn>;
	save: (body: EscapeRunBody) => Promise<SavedEscapeRun>;
}
function initial(levelId: number): Snapshot {
	return {
		game: createGame(levelId),
		trace: [],
		running: false,
		thinking: false,
		model: null,
		usage: { promptTokens: 0, completionTokens: 0, cost: 0, durationMs: 0 },
		error: null,
		saving: false,
		saveError: null,
		saved: null,
	};
}
function asError(error: unknown) {
	return error instanceof Error
		? error
		: new Error("The Escape request failed. Try again.");
}

/** Owns in-flight turns so rapid taps and late responses cannot fork a run. */
export class EscapeSession {
	private snapshot = initial(ESCAPE_FIRST_LEVEL_ID);
	private listeners = new Set<() => void>();
	private revision = 0;
	private request: AbortController | null = null;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;
	public constructor(private dependencies: Dependencies) {}
	public getSnapshot = () => this.snapshot;
	public subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	private update(patch: Partial<Snapshot>) {
		this.snapshot = { ...this.snapshot, ...patch };
		for (const listener of this.listeners) {
			listener();
		}
	}
	public pause = () => {
		clearTimeout(this.timer);
		this.update({ running: false });
	};
	public reset = (levelId = this.snapshot.game.levelId) => {
		this.revision++;
		clearTimeout(this.timer);
		this.request?.abort();
		this.request = null;
		this.snapshot = initial(levelId);
		this.update({});
	};
	public dispose = () => {
		this.disposed = true;
		this.reset();
		this.listeners.clear();
	};
	public start = (model: string) => {
		if (this.disposed || this.snapshot.game.outcome !== "running") {
			return;
		}
		this.update({ running: true });
		void this.step(model);
	};
	public step = async (model: string) => {
		if (
			this.disposed ||
			this.request ||
			this.snapshot.game.outcome !== "running"
		) {
			return;
		}
		clearTimeout(this.timer);
		const revision = this.revision;
		const request = new AbortController();
		this.request = request;
		const selected = this.snapshot.model ?? model;
		this.update({ thinking: true, error: null, model: selected });
		try {
			const turn = await this.dependencies.turn(
				{
					levelId: this.snapshot.game.levelId,
					moves: this.snapshot.game.moves,
					model: selected,
				},
				request.signal,
			);
			if (revision !== this.revision || this.disposed) {
				return;
			}
			const previous = this.snapshot.usage;
			const finished = turn.state.outcome !== "running";
			this.update({
				game: turn.state,
				trace: [...this.snapshot.trace, { ...turn, id: turn.state.step }],
				usage: {
					promptTokens: previous.promptTokens + turn.usage.promptTokens,
					completionTokens:
						previous.completionTokens + turn.usage.completionTokens,
					cost: previous.cost + turn.usage.cost,
					durationMs: previous.durationMs + turn.usage.durationMs,
				},
				running: !finished && this.snapshot.running,
			});
			if (finished) {
				void this.save();
			}
		} catch (error) {
			if (revision === this.revision && !this.disposed) {
				this.update({ error: asError(error), running: false });
			}
		} finally {
			if (revision === this.revision && !this.disposed) {
				this.request = null;
				this.update({ thinking: false });
				if (this.snapshot.running) {
					this.timer = setTimeout(() => void this.step(selected), 420);
				}
			}
		}
	};
	public save = async () => {
		const { game, model, usage, saving, saved, trace } = this.snapshot;
		if (
			this.disposed ||
			game.outcome === "running" ||
			!model ||
			saving ||
			saved
		) {
			return;
		}
		const revision = this.revision;
		this.update({ saving: true, saveError: null });
		try {
			const result = await this.dependencies.save({
				levelId: game.levelId,
				moves: game.moves,
				model,
				usedModel: trace.at(-1)?.usedModel ?? undefined,
				...usage,
			});
			if (revision === this.revision && !this.disposed) {
				this.update({ saved: result });
			}
		} catch (error) {
			if (revision === this.revision && !this.disposed) {
				this.update({ saveError: asError(error) });
			}
		} finally {
			if (revision === this.revision && !this.disposed) {
				this.update({ saving: false });
			}
		}
	};
}
