import { ChevronsUpDown, Check, PlusCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";

import { NewProjectDialog } from "./new-project-dialog";

import type { Project, Organization } from "@/lib/types";

interface ProjectSwitcherProps {
	projects: Project[];
	selectedProject: Project | null;
	onSelectProject: (project: Project | null) => void;
	currentOrganization: Organization | null;
	onProjectCreated: (project: Project) => void;
}

export function ProjectSwitcher({
	projects,
	selectedProject,
	onSelectProject,
	currentOrganization,
	onProjectCreated,
}: ProjectSwitcherProps) {
	const [isNewProjectDialogOpen, setIsNewProjectDialogOpen] = useState(false);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild disabled={!currentOrganization}>
					<Button
						variant="ghost"
						className="flex min-w-[180px] items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 justify-start"
					>
						<span className="truncate">
							{selectedProject ? selectedProject.name : "Select Project"}
						</span>
						<ChevronsUpDown className="ml-auto h-4 w-4 flex-shrink-0 opacity-50" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent className="w-64 border-border bg-background text-foreground shadow-xl">
					<DropdownMenuLabel className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
						Projects in {currentOrganization?.name || "Organization"}
					</DropdownMenuLabel>
					<DropdownMenuSeparator className="bg-border" />
					<DropdownMenuGroup>
						{projects.length > 0 ? (
							projects.map((project) => (
								<DropdownMenuItem
									key={project.id}
									onSelect={() => onSelectProject(project)}
									className="cursor-pointer px-2 py-1.5 text-sm hover:bg-accent focus:bg-accent data-[highlighted]:bg-accent"
								>
									<span className="truncate">{project.name}</span>
									{selectedProject?.id === project.id && (
										<Check className="ml-auto h-4 w-4 flex-shrink-0" />
									)}
								</DropdownMenuItem>
							))
						) : (
							<DropdownMenuItem
								disabled
								className="px-2 py-1.5 text-sm text-muted-foreground"
							>
								No projects yet
							</DropdownMenuItem>
						)}
					</DropdownMenuGroup>
					<DropdownMenuSeparator className="bg-border" />
					<DropdownMenuItem
						onSelect={() => setIsNewProjectDialogOpen(true)}
						className="cursor-pointer px-2 py-1.5 text-sm hover:bg-accent focus:bg-accent data-[highlighted]:bg-accent"
					>
						<PlusCircle className="mr-2 h-4 w-4" />
						New Project
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			{currentOrganization && (
				<NewProjectDialog
					isOpen={isNewProjectDialogOpen}
					setIsOpen={setIsNewProjectDialogOpen}
					selectedOrganization={currentOrganization}
					onProjectCreated={onProjectCreated}
				/>
			)}
		</>
	);
}
