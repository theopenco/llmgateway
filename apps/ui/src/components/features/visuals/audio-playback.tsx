"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import s from "./visuals.module.css";

import type { CSSProperties } from "react";

export const BAR_HEIGHTS = [
	0.35, 0.6, 0.9, 0.5, 0.75, 1, 0.65, 0.4, 0.8, 0.55, 0.95, 0.7, 0.45, 0.85,
	0.6, 0.3, 0.7, 1, 0.5, 0.8, 0.4, 0.65, 0.9, 0.55, 0.75, 0.35, 0.6, 0.85, 0.5,
	0.7, 0.45, 0.9, 0.6, 0.4, 0.8, 0.55,
];

export function AudioPlayback({
	mode,
	src,
	words,
	times,
}: {
	mode: "speech" | "transcription";
	src: string;
	words: string[];
	times: Array<[number, number]>;
}) {
	const audioRef = useRef<HTMLAudioElement>(null);
	const [playing, setPlaying] = useState(false);
	const [time, setTime] = useState(0);
	const [duration, setDuration] = useState(times.at(-1)?.[1] ?? 1);

	useEffect(() => {
		if (!playing) {
			return;
		}
		let frame = 0;
		const tick = () => {
			setTime(audioRef.current?.currentTime ?? 0);
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [playing]);

	const toggle = () => {
		const audio = audioRef.current;
		if (!audio) {
			return;
		}
		if (audio.paused) {
			void audio.play();
		} else {
			audio.pause();
		}
	};

	const started = playing || time > 0;
	const progress = time / duration;
	const active = times.findIndex(
		([start, end]) => started && time >= start && time < end,
	);

	const player = (
		<div className="flex items-center gap-3 rounded-xl border border-border bg-background/85 p-3">
			<audio
				ref={audioRef}
				src={src}
				preload="metadata"
				onPlay={() => setPlaying(true)}
				onPause={() => setPlaying(false)}
				onEnded={() => {
					setPlaying(false);
					setTime(0);
				}}
				onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
			/>
			<button
				type="button"
				onClick={toggle}
				aria-label={playing ? "Pause audio" : "Play audio"}
				className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--fa)] text-white transition-transform duration-150 ease-out active:scale-[0.94] dark:text-zinc-950"
			>
				{playing ? (
					<Pause className="size-4 fill-current" />
				) : (
					<Play className="size-4 translate-x-px fill-current" />
				)}
			</button>
			<div
				className="flex h-14 min-w-0 flex-1 items-center gap-[3px]"
				aria-hidden
			>
				{BAR_HEIGHTS.map((height, i) => {
					const position = i / BAR_HEIGHTS.length;
					const reached = !started || position < progress;
					return (
						<span
							key={i}
							className={cn(
								"min-w-[2px] flex-1 rounded-full transition-colors duration-150",
								playing && s.wave,
								reached ? "bg-[var(--fa)]" : "bg-muted-foreground/30",
							)}
							style={{ "--i": i, height: `${height * 100}%` } as CSSProperties}
						/>
					);
				})}
			</div>
			<span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
				{(started ? time : duration).toFixed(1)}s
			</span>
		</div>
	);

	if (mode === "speech") {
		return (
			<div className="space-y-5">
				<p className="flex flex-wrap gap-x-1 gap-y-1 text-lg font-medium leading-relaxed">
					{words.map((word, i) => {
						const spoken = started && time >= times[i][1];
						return (
							<span
								key={word}
								className={cn(
									"rounded px-0.5 transition-colors duration-150",
									i === active &&
										"bg-[color-mix(in_oklab,var(--fa)_22%,transparent)]",
									!started || spoken || i === active
										? "text-foreground"
										: "text-muted-foreground",
								)}
							>
								{word}
							</span>
						);
					})}
				</p>
				{player}
			</div>
		);
	}

	return (
		<div className="space-y-5">
			{player}
			<div className="flex flex-wrap gap-2">
				{words.map((word, i) => (
					<span
						key={word}
						className={cn(
							s.pop,
							"rounded-lg border bg-background/85 px-2.5 py-1.5 transition-colors duration-150",
							i === active
								? "border-[var(--fa)] bg-[color-mix(in_oklab,var(--fa)_14%,transparent)]"
								: "border-border",
						)}
						style={{ "--i": i + i } as CSSProperties}
					>
						<span className="block font-mono text-[10px] text-muted-foreground">
							{times[i][0].toFixed(2)}s
						</span>
						<span className="text-sm font-medium">{word}</span>
					</span>
				))}
			</div>
		</div>
	);
}
