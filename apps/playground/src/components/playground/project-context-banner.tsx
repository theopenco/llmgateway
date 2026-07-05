"use client";

import { FolderIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { useChatProject } from "@/hooks/useChatProjects";

interface ProjectContextBannerProps {
	projectId: string;
}

// Slim bar under the chat header showing that the current chat runs with a
// project's knowledge base and instructions.
export function ProjectContextBanner({ projectId }: ProjectContextBannerProps) {
	const { data } = useChatProject(projectId);
	const project = data?.project;
	// Preserve the selected organization so the link opens the same projects
	// context the chat is running under.
	const searchParams = useSearchParams();
	const orgIdParam = searchParams.get("orgId");

	if (!project) {
		return null;
	}

	return (
		<div className="shrink-0 border-b bg-muted/40 px-4 py-1.5">
			<Link
				href={`/projects?id=${project.id}${orgIdParam ? `&orgId=${orgIdParam}` : ""}`}
				className="inline-flex max-w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
			>
				<FolderIcon className="h-3.5 w-3.5 shrink-0" />
				<span className="truncate font-medium">{project.name}</span>
				{project.fileCount > 0 && (
					<span className="shrink-0">
						· {project.fileCount} {project.fileCount === 1 ? "file" : "files"}{" "}
						in knowledge base
					</span>
				)}
			</Link>
		</div>
	);
}
