"use client";

import { NotificationsBell } from "@/components/dashboard/CarrierProfileReminder";
import { ThemeToggle } from "@/components/ThemeToggle";

export function TopBarActions() {
	return (
		<div className="flex shrink-0 items-center gap-2">
			<NotificationsBell />
			<ThemeToggle size="compact" />
		</div>
	);
}
