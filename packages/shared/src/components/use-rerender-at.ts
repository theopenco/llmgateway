"use client";

import { useEffect, useReducer } from "react";

// Wake at most daily so long-lived tabs eventually schedule distant boundaries
// without overflowing setTimeout's signed 32-bit delay.
const MAX_DELAY_MS = 24 * 60 * 60 * 1000;

export function getRerenderDelay(time: number, now = Date.now()): number {
	return Math.min(Math.max(time - now + 1000, 0), MAX_DELAY_MS);
}

/**
 * Re-render once when the clock crosses `at`.
 *
 * State derived from `new Date()` at render time (a renewal that has come due,
 * say) otherwise stays stale on an open tab: the polling query keeps returning
 * the same persisted row, so structural sharing hands back the same reference
 * and nothing re-renders.
 */
export function useRerenderAt(at: Date | null) {
	const [, rerender] = useReducer((tick: number) => tick + 1, 0);
	const time = at?.getTime() ?? null;

	useEffect(() => {
		if (time === null) {
			return;
		}
		let timer: ReturnType<typeof setTimeout>;
		const schedule = () => {
			// A second past the boundary, so the re-render reads a clock that has
			// definitely crossed it rather than landing exactly on it.
			const delay = getRerenderDelay(time);
			if (delay === 0) {
				timer = setTimeout(rerender, 0);
				return;
			}
			timer = setTimeout(schedule, Math.min(delay, MAX_DELAY_MS));
		};
		schedule();
		return () => clearTimeout(timer);
	}, [time]);
}
