import { SdkSettings } from "@/components/settings/sdk-settings";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { fetchServerData } from "@/lib/server-api";

import type { Project } from "@/lib/types";

export default async function SdkPage({
	params,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
}) {
	const { orgId, projectId } = await params;
	const projectData = await fetchServerData<{ project: Project }>(
		"GET",
		"/projects/{id}",
		{
			params: {
				path: {
					id: projectId,
				},
			},
		},
	);

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="mx-auto max-w-3xl space-y-6">
					<div className="flex items-center justify-between">
						<h2 className="text-3xl font-bold tracking-tight">Payments SDK</h2>
					</div>
					<Card>
						<CardHeader>
							<CardTitle>Embeddable Payments</CardTitle>
							<CardDescription>
								Embed end-user payments and sessions into your own site:
								configure end-user sessions and platform secret keys for this
								project.
							</CardDescription>
						</CardHeader>
						<CardContent>
							{projectData?.project ? (
								<SdkSettings
									initialProject={projectData.project}
									orgId={orgId}
									projectId={projectId}
								/>
							) : (
								<p className="text-muted-foreground text-sm">
									Project settings could not be loaded.
								</p>
							)}
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
