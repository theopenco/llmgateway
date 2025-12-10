"use client";

import { usePathname } from "next/navigation";

import { ModelSearch } from "@/components/shared/model-search";

import { ProjectSwitcher } from "./project-switcher";

import type { Organization, Project } from "@/lib/types";

interface TopBarProps {
	projects: Project[];
	selectedProject: Project | null;
	onSelectProject: (project: Project | null) => void;
	selectedOrganization: Organization | null;
	onProjectCreated: (project: Project) => void;
}

export function TopBar({
	projects,
	selectedProject,
	onSelectProject,
	selectedOrganization,
	onProjectCreated,
}: TopBarProps) {
	const pathname = usePathname();

	// Hide project switcher on org-only pages
	const isOrgOnlyPage = pathname.includes("/org/");

	return (
		<header className="sticky md:top-0 top-13 z-40 flex h-16 flex-shrink-0 items-center gap-2 border-b border-border bg-background px-4 sm:px-6">
			{selectedOrganization && !isOrgOnlyPage && (
				<ProjectSwitcher
					projects={projects}
					selectedProject={selectedProject}
					onSelectProject={onSelectProject}
					currentOrganization={selectedOrganization}
					onProjectCreated={onProjectCreated}
				/>
			)}
			<div className="ml-auto flex items-center gap-3">
				<div className="w-[160px] sm:w-[200px]">
					<ModelSearch />
				</div>
			</div>
		</header>
	);
}
