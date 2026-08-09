"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { EscapeBoard } from "@/components/escape/escape-board";
import { Button } from "@/components/ui/button";

import { applyMove, createGame } from "@llmgateway/shared/sandbox-escape";

import type { Direction, GameState } from "@llmgateway/shared/sandbox-escape";

const FRAME_MS = 340;

interface EscapeReplayProps {
	levelId: number;
	moves: Direction[];
}

/**
 * Plays a recorded run back move by move. The run is stored as a move list, so
 * the board is rebuilt from the engine rather than from a saved snapshot.
 */
export function EscapeReplay({ levelId, moves }: EscapeReplayProps) {
	const [cursor, setCursor] = useState(0);
	const [playing, setPlaying] = useState(true);

	// Accumulated in one pass: replaying each prefix from scratch would be
	// quadratic in the move count.
	const frames = useMemo(() => {
		const all: GameState[] = [createGame(levelId)];
		for (const move of moves) {
			all.push(applyMove(all[all.length - 1], move));
		}
		return all;
	}, [levelId, moves]);

	const atEnd = cursor >= frames.length - 1;

	useEffect(() => {
		if (!playing || atEnd) {
			return;
		}
		const timer = setTimeout(
			() => setCursor((current) => current + 1),
			FRAME_MS,
		);
		return () => clearTimeout(timer);
	}, [playing, atEnd, cursor]);

	useEffect(() => {
		if (atEnd) {
			setPlaying(false);
		}
	}, [atEnd]);

	const restart = useCallback(() => {
		setCursor(0);
		setPlaying(true);
	}, []);

	const state = frames[Math.min(cursor, frames.length - 1)];

	return (
		<div className="flex flex-col gap-3">
			<EscapeBoard state={state} />
			<div className="flex items-center gap-2">
				{atEnd ? (
					<Button size="sm" variant="secondary" onClick={restart}>
						<RotateCcw className="mr-1.5 h-3.5 w-3.5" />
						Replay
					</Button>
				) : (
					<Button
						size="sm"
						variant="secondary"
						onClick={() => setPlaying((current) => !current)}
					>
						{playing ? (
							<Pause className="mr-1.5 h-3.5 w-3.5" />
						) : (
							<Play className="mr-1.5 h-3.5 w-3.5" />
						)}
						{playing ? "Pause" : "Play"}
					</Button>
				)}
				<input
					type="range"
					min={0}
					max={frames.length - 1}
					value={cursor}
					onChange={(event) => {
						setPlaying(false);
						setCursor(Number(event.target.value));
					}}
					aria-label="Replay position"
					className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-emerald-950 accent-emerald-400"
				/>
				<span className="w-16 shrink-0 text-right font-mono text-[10px] text-emerald-500/50 tabular-nums">
					{cursor}/{frames.length - 1}
				</span>
			</div>
			<p className="font-mono text-[10px] leading-relaxed text-emerald-500/40">
				{state.lastEvent}
			</p>
		</div>
	);
}
