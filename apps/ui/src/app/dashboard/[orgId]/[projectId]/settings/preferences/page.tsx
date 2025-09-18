import { Suspense } from "react";

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";

import { ArchiveProjectSettings } from "./_components/archive-project";
import { CachingSettingsRsc } from "./_components/caching-settings-rsc";
import { ProjectModeSettingsRsc } from "./_components/project-mode-settings-rsc";
import { CachingSettingsSkeleton } from "./_skeletons/caching-settings-skeleton";
import { ProjectModeSkeleton } from "./_skeletons/project-mode-skeleton";

export default async function PreferencesPage({
	params,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
}) {
	const { orgId, projectId } = await params;

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between">
					<h2 className="text-3xl font-bold tracking-tight">Preferences</h2>
				</div>
				<div className="space-y-6">
					<Card>
						<CardHeader>
							<CardTitle>Project Mode</CardTitle>
							<CardDescription>
								Configure how your organization handles projects
							</CardDescription>
						</CardHeader>
						<CardContent>
							<Suspense fallback={<ProjectModeSkeleton />}>
								<ProjectModeSettingsRsc orgId={orgId} projectId={projectId} />
							</Suspense>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Caching</CardTitle>
							<CardDescription>
								Configure caching settings for your API requests
							</CardDescription>
						</CardHeader>
						<CardContent>
							<Suspense fallback={<CachingSettingsSkeleton />}>
								<CachingSettingsRsc orgId={orgId} projectId={projectId} />
							</Suspense>
						</CardContent>
					</Card>

					<Card className="border-destructive/20">
						<CardHeader>
							<CardTitle className="text-destructive">Danger Zone</CardTitle>
							<CardDescription>
								Irreversible and destructive actions
							</CardDescription>
						</CardHeader>
						<CardContent>
							<Suspense fallback={<div>Loading...</div>}>
								<ArchiveProjectSettings orgId={orgId} projectId={projectId} />
							</Suspense>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
