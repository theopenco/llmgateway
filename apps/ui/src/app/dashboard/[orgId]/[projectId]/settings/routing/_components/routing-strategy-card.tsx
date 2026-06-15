"use client";

import { RoutingStrategySettings } from "@/components/settings/routing-strategy-settings";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { useApi } from "@/lib/fetch-client";

export function RoutingStrategyCard({
	orgId,
	projectId,
}: {
	orgId: string;
	projectId: string;
}) {
	const api = useApi();
	const { data } = api.useQuery("get", "/projects/{id}", {
		params: { path: { id: projectId } },
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle>Routing Strategy</CardTitle>
				<CardDescription>
					Set the default provider-selection strategy for this project.
					Available on all plans.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{data?.project ? (
					<RoutingStrategySettings
						initialStrategy={data.project.defaultRoutingStrategy}
						orgId={orgId}
						projectId={projectId}
					/>
				) : (
					<p className="text-sm text-muted-foreground">Loading…</p>
				)}
			</CardContent>
		</Card>
	);
}
