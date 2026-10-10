"use client";

import { formatDistanceToNow } from "date-fns";

import { cn } from "@/lib/utils";

/**
 * Filings, claims and invites are read as "how long has this been sitting
 * there", so the relative age leads and the exact timestamp stays one hover
 * away.
 */
export function RelativeDate({
	date,
	className,
}: {
	date: string | null | undefined;
	className?: string;
}) {
	if (!date) {
		return <span className={className}>—</span>;
	}
	const value = new Date(date);
	if (Number.isNaN(value.getTime())) {
		return <span className={className}>—</span>;
	}
	return (
		<time
			dateTime={value.toISOString()}
			title={value.toLocaleString("en-US", {
				year: "numeric",
				month: "short",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
				timeZoneName: "short",
			})}
			className={cn("cursor-help whitespace-nowrap", className)}
		>
			{formatDistanceToNow(value, { addSuffix: true })}
		</time>
	);
}
