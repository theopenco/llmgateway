"use client";

import { ChevronsUpDown, Check, PlusCircle } from "lucide-react";
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

import { NewOrganizationDialog } from "./new-organization-dialog";

import type { Organization } from "@/lib/types";

interface OrganizationSwitcherProps {
	organizations: Organization[];
	selectedOrganization: Organization | null;
	onSelectOrganization: (org: Organization | null) => void;
	onOrganizationCreated: (org: Organization) => void;
}

export function OrganizationSwitcher({
	organizations,
	selectedOrganization,
	onSelectOrganization,
	onOrganizationCreated,
}: OrganizationSwitcherProps) {
	const [isNewOrgDialogOpen, setIsNewOrgDialogOpen] = useState(false);
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	if (!mounted) {
		return (
			<Button
				variant="ghost"
				disabled
				className="flex min-w-[180px] items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background justify-start"
			>
				<span className="truncate">
					{selectedOrganization
						? selectedOrganization.name
						: "Select Organization"}
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
						className="flex min-w-[180px] items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background justify-start"
					>
						<span className="truncate">
							{selectedOrganization
								? selectedOrganization.name
								: "Select Organization"}
						</span>
						<ChevronsUpDown className="ml-auto h-4 w-4 flex-shrink-0 opacity-50" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent className="w-60 border-border bg-background text-foreground shadow-xl">
					<DropdownMenuLabel className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
						Organizations
					</DropdownMenuLabel>
					<DropdownMenuSeparator className="bg-border" />
					{organizations.map((org) => (
						<DropdownMenuItem
							key={org.id}
							onSelect={() => onSelectOrganization(org)}
							className="cursor-pointer px-2 py-1.5 text-sm hover:bg-accent focus:bg-accent data-[highlighted]:bg-accent"
						>
							<span className="truncate">{org.name}</span>
							{selectedOrganization?.id === org.id && (
								<Check className="ml-auto h-4 w-4 flex-shrink-0" />
							)}
						</DropdownMenuItem>
					))}
					<DropdownMenuSeparator className="bg-border" />
					<DropdownMenuItem
						onSelect={() => setIsNewOrgDialogOpen(true)}
						className="cursor-pointer px-2 py-1.5 text-sm hover:bg-accent focus:bg-accent data-[highlighted]:bg-accent"
					>
						<PlusCircle className="mr-2 h-4 w-4" />
						New Organization
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<NewOrganizationDialog
				isOpen={isNewOrgDialogOpen}
				setIsOpen={setIsNewOrgDialogOpen}
				onOrganizationCreated={onOrganizationCreated}
			/>
		</>
	);
}
