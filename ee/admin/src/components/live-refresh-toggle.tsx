"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const LIVE_REFRESH_INTERVAL_MS = 10_000;

/**
 * Seconds since the last successful fetch, ticking once a second so the
 * staleness of a paused view is always visible.
 */
export function useSecondsSince(timestamp: number | null): number | null {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);

	if (timestamp === null) {
		return null;
	}
	return Math.max(0, Math.floor((now - timestamp) / 1000));
}

export function LiveRefreshToggle({
	live,
	onLiveChange,
	updatedSecondsAgo,
	isFetching,
}: {
	live: boolean;
	onLiveChange: (live: boolean) => void;
	updatedSecondsAgo: number | null;
	isFetching: boolean;
}) {
	return (
		<div className="inline-flex items-center gap-2">
			<Button
				type="button"
				variant={live ? "default" : "outline"}
				size="sm"
				className="h-8 gap-1.5 px-3 text-xs"
				aria-pressed={live}
				onClick={() => onLiveChange(!live)}
			>
				{live ? (
					<Pause className="h-3.5 w-3.5" aria-hidden />
				) : (
					<Play className="h-3.5 w-3.5" aria-hidden />
				)}
				{live ? "Live" : "Paused"}
			</Button>
			<span
				className={cn(
					"text-xs tabular-nums text-muted-foreground",
					isFetching && "animate-pulse",
				)}
			>
				{isFetching
					? "updating…"
					: updatedSecondsAgo === null
						? ""
						: `updated ${updatedSecondsAgo}s ago`}
			</span>
		</div>
	);
}
