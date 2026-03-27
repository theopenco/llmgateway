import { RecentLogs } from "@/components/activity/recent-logs";
import { Card, CardContent } from "@/lib/components/card";
import { fetchModels, fetchProviders } from "@/lib/fetch-models";

export default async function ActivityPage({
	params,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
}) {
	const { orgId, projectId } = await params;

	const [providers, models] = await Promise.all([
		fetchProviders(),
		fetchModels(),
	]);

	const providerOptions = providers
		.map((provider) => ({
			id: provider.id,
			label: provider.name ?? provider.id,
		}))
		.toSorted((a, b) => a.label.localeCompare(b.label));

	const modelOptions = models
		.map((model) => ({
			id: model.id,
			label: model.name ?? model.id,
			aliases: model.aliases ?? [],
			providerIds: Array.from(
				new Set(model.mappings.map((mapping) => mapping.providerId)),
			).toSorted(),
		}))
		.toSorted((a, b) => a.label.localeCompare(b.label));

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<h2 className="text-3xl font-bold tracking-tight">Activity Logs</h2>
				<p>Your recent API requests and system events</p>
				<div className="space-y-4">
					<Card>
						<CardContent>
							<RecentLogs
								providerOptions={providerOptions}
								modelOptions={modelOptions}
								projectId={projectId}
								orgId={orgId}
							/>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
