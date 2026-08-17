"use client";

import { useEffect, useState } from "react";

import { formatDateTime } from "@/lib/format-date.js";

/**
 * Renders a date in the given IANA time zone. Mount-gated: renders nothing on
 * the server / first paint, so it never flashes a server-side UTC guess and
 * can't cause a hydration mismatch. Pass the timezone from the user record
 * (<Time timeZone={user?.timezone} />); defaults to UTC when omitted.
 */
export function Time({
	date,
	format,
	timeZone,
	className,
}: {
	date: Date | string;
	format: string;
	timeZone?: string | null;
	className?: string;
}) {
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	if (!mounted) {
		return null;
	}
	const value = typeof date === "string" ? date : date.toISOString();
	return (
		<span className={className}>
			{formatDateTime(value, timeZone || "UTC", format)}
		</span>
	);
}
