"use client";

import { ChevronsUpDown, Check, Sparkles, Building2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSidebar } from "@/components/ui/sidebar";

import type { Organization } from "@/lib/types";

interface OrganizationSwitcherProps {
	organizations: Organization[];
	selectedOrganization: Organization | null;
	onSelectOrganization: (org: Organization | null) => void;
}

export function OrganizationSwitcher({
	organizations,
	selectedOrganization,
	onSelectOrganization,
}: OrganizationSwitcherProps) {
	const [mounted, setMounted] = useState(false);
	const { isMobile, setOpenMobile } = useSidebar();

	useEffect(() => {
		setMounted(true);
	}, []);

	const handleSelectOrganization = (org: Organization | null) => {
		if (isMobile) {
			setOpenMobile(false);
		}
		onSelectOrganization(org);
	};

	// The dedicated Chat org backs the "Chat plan" context. Treat it like the
	// null selection so the trigger shows the Chat plan branding (Sparkles +
	// "Chat plan") instead of an org icon that looks like a real organization.
	const isChatPlanContext =
		!selectedOrganization || selectedOrganization.isChat;

	const activeClass = isChatPlanContext
		? ""
		: "bg-accent text-accent-foreground";

	if (!mounted) {
		return (
			<Button
				variant="ghost"
				disabled
				className={`flex w-full min-w-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background justify-start ${activeClass}`}
			>
				{isChatPlanContext ? (
					<Sparkles className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
				) : (
					<Building2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
				)}
				<span className="truncate">
					{isChatPlanContext ? "Chat plan" : selectedOrganization!.name}
				</span>
				<ChevronsUpDown className="ml-auto h-4 w-4 flex-shrink-0 opacity-50" />
			</Button>
		);
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						className={`flex w-full min-w-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background justify-start ${activeClass}`}
					>
						{isChatPlanContext ? (
							<Sparkles className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
						) : (
							<Building2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
						)}
						<span className="truncate">
							{isChatPlanContext ? "Chat plan" : selectedOrganization!.name}
						</span>
						<ChevronsUpDown className="ml-auto h-4 w-4 flex-shrink-0 opacity-50" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent className="w-60 border-border bg-background text-foreground shadow-xl">
					<DropdownMenuItem
						onSelect={() => handleSelectOrganization(null)}
						className="cursor-pointer px-2 py-1.5 text-sm hover:bg-accent focus:bg-accent data-[highlighted]:bg-accent"
					>
						<Sparkles className="mr-2 h-4 w-4 flex-shrink-0 text-muted-foreground" />
						<span className="truncate">Chat plan</span>
						{isChatPlanContext ? (
							<Check className="ml-auto h-4 w-4 flex-shrink-0" />
						) : null}
					</DropdownMenuItem>
					<DropdownMenuSeparator className="bg-border" />
					<DropdownMenuLabel className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
						Organizations
					</DropdownMenuLabel>
					<DropdownMenuSeparator className="bg-border" />
					{organizations.map((org) => (
						<DropdownMenuItem
							key={org.id}
							onSelect={() => handleSelectOrganization(org)}
							className="cursor-pointer px-2 py-1.5 text-sm hover:bg-accent focus:bg-accent data-[highlighted]:bg-accent"
						>
							<Building2 className="mr-2 h-4 w-4 flex-shrink-0 text-muted-foreground" />
							<span className="truncate">{org.name}</span>
							{selectedOrganization?.id === org.id && (
								<Check className="ml-auto h-4 w-4 flex-shrink-0" />
							)}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</>
	);
}
