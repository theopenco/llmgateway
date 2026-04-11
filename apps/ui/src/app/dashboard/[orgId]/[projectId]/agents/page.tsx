import { AgentsView } from "@/components/activity/agents-view";

export default async function AgentsPage({
	params,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
}) {
	const { orgId, projectId } = await params;

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div>
					<h2 className="text-3xl font-bold tracking-tight">Agents</h2>
					<p className="text-muted-foreground">
						Monitor your AI coding agents and their activity
					</p>
				</div>
				<AgentsView projectId={projectId} orgId={orgId} />
			</div>
		</div>
	);
}
