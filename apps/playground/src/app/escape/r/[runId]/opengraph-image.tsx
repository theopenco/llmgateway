import { ImageResponse } from "next/og";

import { fetchEscapeRun } from "@/lib/escape-run";

import { isDirection, replayGame } from "@llmgateway/shared/sandbox-escape";

import type { Direction, GameState } from "@llmgateway/shared/sandbox-escape";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const OUTCOME = {
	escaped: {
		label: "ESCAPED",
		color: "#6ee7b7",
		glow: "rgba(52,211,153,0.22)",
	},
	terminated: {
		label: "TERMINATED",
		color: "#fda4af",
		glow: "rgba(244,63,94,0.2)",
	},
	timeout: {
		label: "RECLAIMED",
		color: "#fcd34d",
		glow: "rgba(251,191,36,0.2)",
	},
} as const;

const MONO = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

function Board({ state }: { state: GameState }) {
	const tile = Math.floor(Math.min(470 / state.width, 400 / state.height));

	return (
		<div style={{ display: "flex", flexDirection: "column" }}>
			{Array.from({ length: state.height }, (_, y) => {
				const rowStart = y * state.width;
				return (
					<div key={y} style={{ display: "flex", flexDirection: "row" }}>
						{Array.from({ length: state.width }, (_, x) => {
							const isPlayer = state.player.x === x && state.player.y === y;
							const isDaemon = state.daemons.some(
								(d) => d.x === x && d.y === y,
							);
							const isShard = state.shards.some((p) => p.x === x && p.y === y);
							const isShell = state.shells.some((p) => p.x === x && p.y === y);
							const isExit = state.exit.x === x && state.exit.y === y;
							const isWall = state.walls[rowStart + x];

							let background = "#070c10";
							let color = "#0f2a20";
							let glyph = "";

							if (isWall) {
								background = "#0d2a20";
							}
							if (isExit) {
								background =
									state.shards.length === 0
										? "rgba(34,211,238,0.28)"
										: "rgba(244,63,94,0.16)";
								color = state.shards.length === 0 ? "#a5f3fc" : "#fda4af";
								glyph = "E";
							}
							if (isShell) {
								color = "#7dd3fc";
								glyph = "$";
							}
							if (isShard) {
								color = "#fcd34d";
								glyph = "K";
							}
							if (isDaemon) {
								background = "rgba(244,63,94,0.3)";
								color = "#ffe4e6";
								glyph = "D";
							}
							if (isPlayer) {
								background = "rgba(52,211,153,0.4)";
								color = "#ecfdf5";
								glyph = state.outcome === "terminated" ? "x" : "@";
							}

							return (
								<div
									key={x}
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										width: tile,
										height: tile,
										background,
										color,
										fontFamily: MONO,
										fontSize: Math.floor(tile * 0.62),
										fontWeight: 700,
										border: "1px solid rgba(16,185,129,0.07)",
									}}
								>
									{glyph}
								</div>
							);
						})}
					</div>
				);
			})}
		</div>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
			<span
				style={{
					fontFamily: MONO,
					fontSize: 15,
					letterSpacing: "0.16em",
					color: "rgba(52,211,153,0.5)",
					textTransform: "uppercase",
				}}
			>
				{label}
			</span>
			<span style={{ fontFamily: MONO, fontSize: 34, color: "#d1fae5" }}>
				{value}
			</span>
		</div>
	);
}

export default async function EscapeRunOgImage({
	params,
}: {
	params: Promise<{ runId: string }>;
}) {
	try {
		const { runId } = await params;
		const data = await fetchEscapeRun(runId);

		if (!data) {
			throw new Error("Run not found");
		}

		const { run } = data;
		const state = replayGame(
			run.levelId,
			run.moves.filter(isDirection) as Direction[],
		);
		const outcome = OUTCOME[run.outcome];

		return new ImageResponse(
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					background: "#04070a",
					backgroundImage: `radial-gradient(circle at 18% 14%, ${outcome.glow}, transparent 46%), radial-gradient(circle at 88% 86%, rgba(16,185,129,0.12), transparent 50%)`,
					color: "white",
					padding: 60,
					boxSizing: "border-box",
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						justifyContent: "space-between",
						flex: 1,
						paddingRight: 40,
					}}
				>
					<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
						<span
							style={{
								fontFamily: MONO,
								fontSize: 18,
								letterSpacing: "0.28em",
								color: "rgba(52,211,153,0.55)",
								textTransform: "uppercase",
							}}
						>
							Sandbox Escape · Level {run.levelId}
						</span>
						<span
							style={{
								fontFamily: MONO,
								fontSize: 78,
								fontWeight: 700,
								letterSpacing: "0.06em",
								color: outcome.color,
								lineHeight: 1,
							}}
						>
							{outcome.label}
						</span>
						<span
							style={{
								fontFamily: MONO,
								fontSize: 30,
								color: "#a7f3d0",
								marginTop: 6,
								maxWidth: 560,
								overflow: "hidden",
							}}
						>
							{run.model}
						</span>
					</div>

					<div style={{ display: "flex", gap: 46 }}>
						<Stat label="Steps" value={`${run.steps}`} />
						<Stat label="Par" value={`${run.par}`} />
						<Stat label="Score" value={`${run.score}`} />
						<Stat
							label="Tokens"
							value={`${run.promptTokens + run.completionTokens}`}
						/>
					</div>

					<span
						style={{
							fontFamily: MONO,
							fontSize: 20,
							color: "rgba(52,211,153,0.55)",
						}}
					>
						lounge.llmgateway.io/escape — one API call per step
					</span>
				</div>

				<div
					style={{
						display: "flex",
						alignSelf: "center",
						alignItems: "center",
						justifyContent: "center",
						padding: 14,
						borderRadius: 16,
						border: "1px solid rgba(16,185,129,0.22)",
						background: "rgba(4,7,10,0.8)",
					}}
				>
					<Board state={state} />
				</div>
			</div>,
			size,
		);
	} catch (error) {
		console.error("Error generating Sandbox Escape OpenGraph image:", error);
		return new ImageResponse(
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					background: "#04070a",
					color: "#6ee7b7",
					fontSize: 52,
					fontFamily: MONO,
				}}
			>
				Sandbox Escape
			</div>,
			size,
		);
	}
}
