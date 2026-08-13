"use client";

import { useTimeZonePreference } from "@/hooks/use-time-zone-preference.js";

import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

export function TimeZoneToggle({ className }: { className?: string }) {
	const { pref, setPref } = useTimeZonePreference();
	return (
		<label className={`flex items-center gap-2 ${className ?? ""}`}>
			<Switch
				checked={pref === "local"}
				onCheckedChange={(checked: boolean) =>
					setPref(checked ? "local" : "utc")
				}
			/>
			<Label className="text-xs text-muted-foreground">Local time</Label>
		</label>
	);
}
