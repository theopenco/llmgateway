"use client";

import { useEffect, useReducer } from "react";

// setTimeout stores its delay in a signed 32-bit int, so anything past ~24.8
// days wraps and fires immediately — which would spin a render loop on an
// annual plan. A day is well beyond how long a dashboard tab stays open, so
// anything further out is left to the next mount.
const MAX_DELAY_MS = 24 * 60 * 60 * 1000;

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
		// A second past the boundary, so the re-render reads a clock that has
		// definitely crossed it rather than landing exactly on it.
		const delay = time - Date.now() + 1000;
		if (delay <= 0 || delay > MAX_DELAY_MS) {
			return;
		}
		const timer = setTimeout(rerender, delay);
		return () => clearTimeout(timer);
	}, [time]);
}
