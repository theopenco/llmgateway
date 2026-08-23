"use client";

import { useCallback } from "react";

import {
	formatDayKey,
	shiftDayKey,
	useDisplayTimeZone,
} from "@llmgateway/shared";

/** Marks a `from`/`to` pair in the URL as one we generated rather than one the
 *  user chose. Provenance has to live in the URL: a ref is empty after a
 *  reload or on a shared link, which would strand a generated range in the
 *  zone it was created in. */
export const GENERATED_RANGE_PARAM = "autorange";

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
 *   range generated under the old zone would survive a toggle. Anything the
 *   user picked clears the marker, so only our own defaults get refreshed.
 */
export function useZonedRangeDefaults(days = 6) {
	const { timeZone } = useDisplayTimeZone();

	const to = formatDayKey(new Date(), timeZone);
	const from = shiftDayKey(to, -days);

	/** Stamp the marker onto params the caller is about to write. */
	const markGenerated = useCallback((params: URLSearchParams) => {
		params.set(GENERATED_RANGE_PARAM, "1");
	}, []);

	/** True when the URL range should be (re)written with the defaults above:
	 *  nothing is set yet, or what is set is a stale default of ours. */
	const shouldApplyDefaults = useCallback(
		(params: URLSearchParams) => {
			const currentFrom = params.get("from");
			const currentTo = params.get("to");
			if (!currentFrom || !currentTo) {
				return true;
			}
			if (currentFrom === from && currentTo === to) {
				return false;
			}
			return params.get(GENERATED_RANGE_PARAM) === "1";
		},
		[from, to],
	);

	return { from, to, timeZone, markGenerated, shouldApplyDefaults };
}
