import { ArrowLeft, FolderOpen } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getOrganizationProjects } from "@/lib/admin-organizations";

import { ProjectLogsSection } from "./project-logs";
import { ProjectMetricsSection } from "./project-metrics";

function SignInPrompt() {
	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<div className="w-full max-w-md text-center">
				<div className="mb-8">
					<h1 className="text-3xl font-semibold tracking-tight">
						Admin Dashboard
					</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						Sign in to access the admin dashboard
					</p>
				</div>
				<Button asChild size="lg" className="w-full">
					<Link href="/login">Sign In</Link>
				</Button>
			</div>
		</div>
	);
}

function formatDate(dateString: string) {
	return new Date(dateString).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

export default async function ProjectDetailPage({
	params,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
}) {
	const { orgId, projectId } = await params;

	const projectsData = await getOrganizationProjects(orgId);

	if (!projectsData) {
		return <SignInPrompt />;
	}

	const project = projectsData.projects.find((p) => p.id === projectId);

	if (!project) {
		notFound();
	}

	return (
		<div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-8">
			<header className="space-y-4">
				<Button variant="ghost" size="sm" asChild>
					<Link href={`/organizations/${orgId}`}>
						<ArrowLeft className="mr-2 h-4 w-4" />
						Back to Organization
					</Link>
				</Button>

				<div className="flex items-start justify-between gap-4">
					<div className="flex items-center gap-3">
						<FolderOpen className="h-6 w-6 text-muted-foreground" />
						<div>
							<h1 className="text-2xl font-bold">{project.name}</h1>
							<p className="text-sm text-muted-foreground">{project.id}</p>
						</div>
					</div>
					<Badge
						variant={project.status === "active" ? "secondary" : "outline"}
					>
						{project.status ?? "active"}
					</Badge>
				</div>

				<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
					<Badge variant="outline">{project.mode}</Badge>
					{project.cachingEnabled && (
						<Badge variant="outline">caching enabled</Badge>
					)}
					<span>Created {formatDate(project.createdAt)}</span>
				</div>
			</header>

			<ProjectMetricsSection orgId={orgId} projectId={projectId} />

			<ProjectLogsSection orgId={orgId} projectId={projectId} />
		</div>
	);
}
