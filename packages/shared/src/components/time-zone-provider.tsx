"use client";

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

import {
	DEFAULT_TIME_ZONE_PREFERENCE,
	getBrowserTimeZone,
	serializeTimeZonePreference,
	TIMEZONE_COOKIE_MAX_AGE_DAYS,
	TIMEZONE_COOKIE_NAME,
	UTC_TIME_ZONE,
} from "@/lib/timezone.js";

import type { TimeZoneMode, TimeZonePreference } from "@/lib/timezone.js";
import type { ReactNode } from "react";

interface TimeZoneContextValue extends TimeZonePreference {
	/** The zone this device is actually in, whatever the mode. Used by the
	 *  settings toggle to preview what "Local" would show. */
	browserTimeZone: string;
	setMode: (mode: TimeZoneMode) => void;
}

const TimeZoneContext = createContext<TimeZoneContextValue | null>(null);

function writeCookie(preference: TimeZonePreference) {
	if (typeof document === "undefined") {
		return;
	}
	const maxAge = TIMEZONE_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
	// Readable by client JS on purpose: the toggle updates it without a
	// round-trip, while server components still read it via cookies().
	document.cookie = `${TIMEZONE_COOKIE_NAME}=${encodeURIComponent(
		serializeTimeZonePreference(preference),
	)}; path=/; max-age=${maxAge}; samesite=lax`;
}

/**
 * Seeds the display timezone from the cookie the server already read, so the
 * first client render matches the server HTML exactly (no hydration mismatch,
 * no mount gate, no blank cells).
 *
 * There is no request header that carries a browser's timezone — no standard
 * one exists and no browser sends one — so the zone can only be detected
 * client-side. The bootstrap below does that once and writes it to the cookie,
 * after which every subsequent SSR is exact.
 */
export function TimeZoneProvider({
	initial,
	children,
}: {
	initial: TimeZonePreference;
	children: ReactNode;
}) {
	const [preference, setPreference] = useState<TimeZonePreference>(initial);
	const [browserTimeZone, setBrowserTimeZone] = useState(initial.timeZone);

	useEffect(() => {
		const sync = () => {
			const detected = getBrowserTimeZone();
			setBrowserTimeZone(detected);
			setPreference((current) => {
				if (current.mode !== "local" || current.timeZone === detected) {
					return current;
				}
				// Either the cookie is missing (server fell back to UTC) or the
				// machine's zone has changed since it was written — travel, or the
				// OS correcting itself. Either way the detected zone wins.
				const next: TimeZonePreference = { mode: "local", timeZone: detected };
				writeCookie(next);
				return next;
			});
		};
		sync();
		// A long-lived tab outlives a system zone change, and there is no event
		// for one; re-check whenever the tab is looked at again.
		window.addEventListener("focus", sync);
		document.addEventListener("visibilitychange", sync);
		return () => {
			window.removeEventListener("focus", sync);
			document.removeEventListener("visibilitychange", sync);
		};
	}, []);

	const setMode = useCallback((mode: TimeZoneMode) => {
		const next: TimeZonePreference = {
			mode,
			timeZone: mode === "utc" ? UTC_TIME_ZONE : getBrowserTimeZone(),
		};
		writeCookie(next);
		setPreference(next);
	}, []);

	const value = useMemo(
		() => ({ ...preference, browserTimeZone, setMode }),
		[preference, browserTimeZone, setMode],
	);

	return (
		<TimeZoneContext.Provider value={value}>
			{children}
		</TimeZoneContext.Provider>
	);
}

/**
 * The single source of truth for "which zone do we show times in". Drives both
 * rendering and the `timezone` query param the analytics endpoints bucket by,
 * so a chart's bars and its axis labels can never disagree.
 */
export function useDisplayTimeZone(): TimeZoneContextValue {
	return useContext(TimeZoneContext) ?? FALLBACK;
}

// Surfaces outside the dashboard tree (marketing, auth) render dates too and
// have no provider. Same value the server uses when the cookie is absent.
const FALLBACK: TimeZoneContextValue = {
	...DEFAULT_TIME_ZONE_PREFERENCE,
	browserTimeZone: UTC_TIME_ZONE,
	setMode: () => {},
};
