"use client";

import { useCallback, useRef } from "react";

import {
	formatDayKey,
	shiftDayKey,
	useDisplayTimeZone,
} from "@llmgateway/shared";

/**
 * Default `from`/`to` day keys for the analytics range pickers, derived in the
 * zone those endpoints bucket by.
 *
 * Two things this solves that a bare `new Date()` doesn't:
 *
 * - Near a midnight boundary the browser's calendar day and the display zone's
 *   differ, so a browser-derived range asks for a day the API considers the
 *   future and drops the oldest intended one.
 * - The effects that seed the URL bail out once `from`/`to` are present, so a
 *   range generated under the old zone would survive a toggle. `wasGenerated`
 *   tells a caller whether the current params are its own default (safe to
 *   regenerate) or a range the user picked (leave alone).
 */
export function useZonedRangeDefaults(days = 6) {
	const { timeZone } = useDisplayTimeZone();
	// Every default this hook has handed out, so a range written under a
	// previous zone is still recognised as generated after a toggle.
	const generated = useRef<Set<string>>(new Set());

	const to = formatDayKey(new Date(), timeZone);
	const from = shiftDayKey(to, -days);

	const markGenerated = useCallback((nextFrom: string, nextTo: string) => {
		generated.current.add(`${nextFrom}|${nextTo}`);
	}, []);

	const wasGenerated = useCallback(
		(currentFrom: string | null, currentTo: string | null) =>
			!!currentFrom &&
			!!currentTo &&
			generated.current.has(`${currentFrom}|${currentTo}`),
		[],
	);

	/** True when the URL range should be (re)written with the defaults above:
	 *  either nothing is set yet, or what is set is a stale default of ours. */
	const shouldApplyDefaults = useCallback(
		(currentFrom: string | null, currentTo: string | null) => {
			if (!currentFrom || !currentTo) {
				return true;
			}
			if (currentFrom === from && currentTo === to) {
				return false;
			}
			return generated.current.has(`${currentFrom}|${currentTo}`);
		},
		[from, to],
	);

	return {
		from,
		to,
		timeZone,
		markGenerated,
		wasGenerated,
		shouldApplyDefaults,
	};
}
