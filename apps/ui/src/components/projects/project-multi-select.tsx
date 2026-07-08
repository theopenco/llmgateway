"use client";

import { ChevronsUpDown, X } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/lib/components/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/lib/components/popover";

export interface OrgProject {
	id: string;
	name: string;
}

/**
 * Multi-select for granting project access: selected projects render as
 * removable chips, and a searchable combobox adds more. Shared between the team
 * member access dialogs and the SSO default-project settings.
 */
export function ProjectMultiSelect({
	orgProjects,
	selected,
	onChange,
	emptyText = "This organization has no projects yet. Create a project first.",
}: {
	orgProjects: OrgProject[];
	selected: string[];
	onChange: (projectIds: string[]) => void;
	emptyText?: string;
}) {
	const [open, setOpen] = useState(false);

	if (orgProjects.length === 0) {
		return <p className="text-muted-foreground text-sm">{emptyText}</p>;
	}

	const selectedProjects = selected
		.map((id) => orgProjects.find((p) => p.id === id))
		.filter((p): p is OrgProject => Boolean(p));
	const available = orgProjects.filter((p) => !selected.includes(p.id));

	return (
		<div className="space-y-2">
			{selectedProjects.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{selectedProjects.map((project) => (
						<Badge key={project.id} variant="secondary" className="gap-1 pr-1">
							{project.name}
							<button
								type="button"
								aria-label={`Remove ${project.name}`}
								className="hover:bg-muted-foreground/20 rounded-sm p-0.5"
								onClick={() =>
									onChange(selected.filter((id) => id !== project.id))
								}
							>
								<X className="h-3 w-3" />
							</button>
						</Badge>
					))}
				</div>
			)}

			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						type="button"
						variant="outline"
						role="combobox"
						aria-expanded={open}
						disabled={available.length === 0}
						className="w-full justify-between font-normal"
					>
						<span className="text-muted-foreground">
							{available.length === 0 ? "All projects added" : "Add a project…"}
						</span>
						<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
					</Button>
				</PopoverTrigger>
				<PopoverContent
					className="w-[--radix-popover-trigger-width] p-0"
					align="start"
				>
					<Command>
						<CommandInput placeholder="Search projects…" />
						<CommandList>
							<CommandEmpty>No projects found.</CommandEmpty>
							<CommandGroup>
								{available.map((project) => (
									<CommandItem
										key={project.id}
										value={project.name}
										onSelect={() => {
											onChange([...selected, project.id]);
											setOpen(false);
										}}
									>
										{project.name}
									</CommandItem>
								))}
							</CommandGroup>
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
		</div>
	);
}
