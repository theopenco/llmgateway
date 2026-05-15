"use client";

import { ThemeToggle } from "@/components/landing/theme-toggle";
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
			<div className="ml-3 flex items-center gap-3">
				<ThemeToggle />
				<a
					href={
						process.env.NODE_ENV === "development"
							? "http://localhost:3002/dashboard"
							: "https://llmgateway.io/dashboard"
					}
					target="_blank"
					rel="noopener noreferrer"
					className="hidden sm:inline"
				>
					<span className="text-nowrap">Dashboard</span>
				</a>
			</div>
		</header>
	);
};
