"use client";

import { useEffect, useState } from "react";

import { useTimeZonePreference } from "@/hooks/use-time-zone-preference.js";
import { timeToDisplay } from "@/lib/format-date.js";

export function Time({
	date,
	format,
	className,
}: {
	date: Date | string;
	format: string;
	className?: string;
}) {
	const [mounted, setMounted] = useState(false);
	const { pref } = useTimeZonePreference();
	useEffect(() => setMounted(true), []);
	if (!mounted) {
		return null; // never render a server-TZ guess
	}
	const value = typeof date === "string" ? date : date.toISOString();
	return (
		<span className={className}>{timeToDisplay(value, format, pref)}</span>
	);
}
