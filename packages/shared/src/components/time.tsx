"use client";

import { formatDateTime } from "@/lib/format-date.js";

import { useDisplayTimeZone } from "./time-zone-provider";

import type { DateFormat } from "@/lib/format-date.js";

/**
 * Renders an instant in the user's display timezone, which comes from the
 * cookie the server already read — so this renders identically on the server
 * and on hydration. No mount gate, so tables have their dates in the SSR HTML
 * instead of popping in and shifting layout.
 */
export function Time({
	date,
	format = "monthDayYear",
	className,
}: {
	date: Date | string | number;
	/** Pick a *Zone layout when the value would otherwise be ambiguous about
	 *  which clock it is on. */
	format?: DateFormat;
	className?: string;
}) {
	const { timeZone } = useDisplayTimeZone();
	return (
		<span className={className}>{formatDateTime(date, timeZone, format)}</span>
	);
}
