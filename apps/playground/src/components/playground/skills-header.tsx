"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";

export function SkillsHeader() {
	return (
		<header className="bg-background flex items-center border-b p-4">
			<div className="flex min-w-0 flex-1 items-center gap-3">
				<SidebarTrigger />
				<span className="text-lg font-medium">Skills</span>
			</div>
		</header>
	);
}
