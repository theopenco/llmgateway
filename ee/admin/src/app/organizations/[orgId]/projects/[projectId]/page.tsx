import { ArrowLeft, FolderOpen, LayoutGrid } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LogsSection } from "@/components/logs-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	buildLogModelOptions,
	buildLogProviderOptions,
} from "@/lib/log-filter-options";
import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";

import { ProjectCostByModelTimeseries } from "./project-cost-by-model-timeseries";
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
	await requireSession();

	const { orgId, projectId } = await params;

	const $api = await createServerApiClient();
	const [projectsRes, membersRes] = await Promise.all([
		$api.GET("/admin/organizations/{orgId}/projects", {
			params: { path: { orgId } },
		}),
		$api.GET("/admin/organizations/{orgId}/members", {
			params: { path: { orgId } },
		}),
	]);
	const projectsData = projectsRes.data;

	if (!projectsData) {
		return <SignInPrompt />;
	}

	const project = projectsData.projects.find((p) => p.id === projectId);

	if (!project) {
		notFound();
	}

	const providerOptions = buildLogProviderOptions();
	const modelOptions = buildLogModelOptions();
	const seatOptions = (membersRes.data?.members ?? [])
		.map((member) => ({
			email: member.user.email,
			name: member.user.name,
		}))
		.toSorted((a, b) => a.email.localeCompare(b.email));

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
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

			<ProjectCostByModelTimeseries orgId={orgId} projectId={projectId} />

			<div>
				<Button variant="outline" size="sm" asChild>
					<Link
						href={`/organizations/${orgId}/projects/${projectId}/model-provider-mappings`}
					>
						<LayoutGrid className="mr-2 h-4 w-4" />
						Model-Provider Mappings
					</Link>
				</Button>
			</div>

			<LogsSection
				orgId={orgId}
				projectId={projectId}
				providerOptions={providerOptions}
				modelOptions={modelOptions}
				seatOptions={seatOptions}
			/>
		</div>
	);
}
