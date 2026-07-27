"use client";

import { Mic, MicOff, Volume2 } from "lucide-react";

import { cn } from "@/lib/utils";

interface VoiceActivityIndicatorProps {
	/** The call is live; before that there is nothing to meter. */
	live: boolean;
	muted: boolean;
	userSpeaking: boolean;
	assistantSpeaking: boolean;
	inputLevel: number;
	outputLevel: number;
	className?: string;
}

/** Centre bars react most, so the meter reads as a waveform rather than a bar chart. */
const BAR_WEIGHTS = [0.45, 0.75, 1, 0.75, 0.45];
const METER_HEIGHT_PX = 16;
const METER_MIN_FRACTION = 0.18;

function barHeight(level: number, weight: number): number {
	const scaled = Math.min(1, Math.max(0, level) * weight);
	const variable = (1 - METER_MIN_FRACTION) * scaled;
	return Math.round((METER_MIN_FRACTION + variable) * METER_HEIGHT_PX);
}

function LevelMeter({
	level,
	className,
}: {
	level: number;
	className: string;
}) {
	return (
		<span className="flex h-4 items-center gap-[3px]" aria-hidden="true">
			{BAR_WEIGHTS.map((weight, index) => (
				<span
					key={index}
					className={cn(
						"w-[3px] rounded-full transition-[height] duration-100 ease-out",
						className,
					)}
					style={{ height: `${barHeight(level, weight)}px` }}
				/>
			))}
		</span>
	);
}

/**
 * Live "who has the floor" readout for a realtime call: the microphone meter
 * proves audio is reaching us, and the label reflects the server's own VAD
 * decision about whether the user's turn is being captured.
 */
export function VoiceActivityIndicator({
	live,
	muted,
	userSpeaking,
	assistantSpeaking,
	inputLevel,
	outputLevel,
	className,
}: VoiceActivityIndicatorProps) {
	if (!live) {
		return null;
	}

	const state = muted
		? "muted"
		: assistantSpeaking
			? "assistant"
			: userSpeaking
				? "listening"
				: "idle";

	const label =
		state === "muted"
			? "Microphone muted"
			: state === "assistant"
				? "Assistant speaking"
				: state === "listening"
					? "Listening…"
					: "Waiting for you to speak";

	return (
		<div
			role="status"
			aria-live="polite"
			className={cn(
				"flex items-center gap-2.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
				state === "muted" && "text-muted-foreground border-dashed",
				state === "assistant" &&
					"border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
				state === "listening" &&
					"border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400",
				state === "idle" && "text-muted-foreground",
				className,
			)}
		>
			{state === "muted" ? (
				<MicOff className="h-3.5 w-3.5" />
			) : state === "assistant" ? (
				<Volume2 className="h-3.5 w-3.5" />
			) : (
				<Mic
					className={cn(
						"h-3.5 w-3.5",
						state === "listening" && "animate-pulse",
					)}
				/>
			)}
			<span>{label}</span>
			<LevelMeter
				level={
					state === "muted"
						? 0
						: state === "assistant"
							? outputLevel
							: inputLevel
				}
				className={
					state === "assistant"
						? "bg-blue-500"
						: state === "listening"
							? "bg-green-500"
							: "bg-muted-foreground/40"
				}
			/>
		</div>
	);
}
