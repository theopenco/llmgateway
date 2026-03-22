import { SessionsView } from "@/components/activity/sessions-view";
import { Card, CardContent } from "@/lib/components/card";

export default async function SessionsPage({
	params,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
}) {
	const { orgId, projectId } = await params;

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div>
					<h2 className="text-3xl font-bold tracking-tight">Sessions</h2>
					<p className="text-muted-foreground">
						Group API requests by session from tools like Claude Code and Open
						Code
					</p>
				</div>
				<Card>
					<CardContent>
						<SessionsView projectId={projectId} orgId={orgId} />
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
