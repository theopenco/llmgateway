"use client";
import Link from "next/link";

import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { useApi } from "@/lib/fetch-client";

export function ApiKeyComplianceList() {
	const { selectedOrganization } = useDashboardNavigation();
	const api = useApi();
	const canManage =
		selectedOrganization?.role === "owner" ||
		selectedOrganization?.role === "admin";
	const { data, isPending, isError, refetch } = api.useQuery(
		"get",
		"/keys/api/compliance",
		{ params: { query: { organizationId: selectedOrganization?.id ?? "" } } },
		{ enabled: canManage && !!selectedOrganization?.id },
	);
	if (!canManage) {
		return null;
	}
	return (
		<div className="px-4 pb-6 md:px-8">
			<Card>
				<CardHeader>
					<CardTitle>API key compliance policies</CardTitle>
					<CardDescription>
						Keys with an explicit policy across this organization. Organization
						restrictions always apply, including when a key policy is disabled.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{isPending ? (
						<p role="status" className="text-sm text-muted-foreground">
							Loading key policies...
						</p>
					) : isError ? (
						<div role="alert" className="flex items-center gap-3 text-sm">
							<p>Unable to load key policies.</p>
							<Button variant="outline" onClick={() => void refetch()}>
								Retry
							</Button>
						</div>
					) : !data?.apiKeys.length ? (
						<p className="text-sm text-muted-foreground">
							No API keys have an explicit compliance policy. Manage a
							key&apos;s compliance from its API key menu.
						</p>
					) : (
						<ul className="divide-y">
							{data.apiKeys.map((key) => (
								<li
									key={key.id}
									className="flex flex-wrap items-center justify-between gap-3 py-3"
								>
									<div className="min-w-0">
										<p className="font-medium">{key.name}</p>
										<p className="text-sm text-muted-foreground">
											{key.projectName} ·{" "}
											{key.providerCompliancePolicy.enabled
												? "Additional restrictions enabled"
												: "Additional restrictions disabled"}
										</p>
									</div>
									<Button asChild variant="outline" size="sm">
										<Link
											href={`/dashboard/${selectedOrganization?.id}/${key.projectId}/api-keys/${key.id}/compliance`}
										>
											Edit policy
											<span className="sr-only"> for {key.name}</span>
										</Link>
									</Button>
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
