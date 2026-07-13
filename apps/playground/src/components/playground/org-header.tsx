"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";

interface OrgHeaderProps {
	organizationName?: string;
}

export const OrgHeader = ({ organizationName }: OrgHeaderProps) => {
	return (
		<header className="bg-background flex items-center border-b p-4">
			<div className="flex min-w-0 flex-1 items-center gap-3">
				<SidebarTrigger />
				{organizationName ? (
					<span className="text-sm font-medium text-muted-foreground truncate">
						{organizationName}
					</span>
				) : null}
			</div>
		</header>
	);
};
