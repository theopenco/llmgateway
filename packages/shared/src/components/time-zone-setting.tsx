"use client";

import { getBrowserTimeZone } from "@/lib/format-date.js";

import { Switch } from "./ui/switch";

/**
 * Settings control for the user's display time zone. `value` is the IANA zone
 * from the user record ("UTC" = default/off). Toggling local sends the
 * browser's detected zone back via `onValueChange` so the caller can persist
 * it (PATCH /user/me) — the component itself never touches the API. Data
 * storage always stays UTC; this only changes presentation.
 */
export function TimeZoneSetting({
	value,
	onValueChange,
	className,
}: {
	value: string;
	onValueChange: (timeZone: string) => void;
	className?: string;
}) {
	const isLocal = value !== "UTC";
	return (
		<div
			className={`flex items-center justify-between gap-4 ${className ?? ""}`}
		>
			<div className="space-y-0.5">
				<p className="text-sm font-medium">Local timezone</p>
				<p className="text-sm text-muted-foreground">
					Show dates and times in your timezone instead of UTC. Data is always
					stored in UTC.
					{isLocal ? ` Currently showing ${value}.` : ""}
				</p>
			</div>
			<Switch
				checked={isLocal}
				onCheckedChange={(checked: boolean) =>
					onValueChange(checked ? getBrowserTimeZone() : "UTC")
				}
			/>
		</div>
	);
}
