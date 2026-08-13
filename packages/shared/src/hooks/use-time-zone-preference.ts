"use client";

import { useCallback, useEffect, useState } from "react";

import {
	type TimeZonePref,
	readTimeZonePref,
	writeTimeZonePref,
} from "@/lib/format-date.js";

const listeners = new Set<() => void>();
let current: TimeZonePref = "utc";

function emit(): void {
	listeners.forEach((l) => l());
}

export function useTimeZonePreference(): {
	pref: TimeZonePref;
	setPref: (pref: TimeZonePref) => void;
} {
	const [pref, setPrefState] = useState<TimeZonePref>(current);
	useEffect(() => {
		const loaded = readTimeZonePref();
		current = loaded;
		setPrefState(loaded);
		const listener = () => setPrefState(current);
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	}, []);

	const setPref = useCallback((next: TimeZonePref) => {
		current = next;
		writeTimeZonePref(next);
		emit();
	}, []);

	return { pref, setPref };
}
