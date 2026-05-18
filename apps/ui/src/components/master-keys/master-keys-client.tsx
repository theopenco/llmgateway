"use client";

import { ExternalLink, Orbit } from "lucide-react";
import { useParams } from "next/navigation";

import { MasterKeysContactSalesCard } from "@/components/master-keys/contact-sales-card";
import { CreateMasterKeyDialog } from "@/components/master-keys/create-master-key-dialog";
import { MasterKeysList } from "@/components/master-keys/master-keys-list";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { Button } from "@/lib/components/button";
import { Card, CardContent, CardHeader } from "@/lib/components/card";
import { useApi } from "@/lib/fetch-client";

export function MasterKeysClient() {
	const params = useParams();
	const organizationId = params.orgId as string;
	const { selectedOrganization } = useDashboardNavigation();
	const api = useApi();

	const isEnterprise = selectedOrganization?.plan === "enterprise";

	const { data } = api.useQuery(
		"get",
		"/master-keys",
		{ params: { query: { organizationId } } },
		{
			enabled: !!organizationId && isEnterprise,
			staleTime: 5 * 60 * 1000,
			refetchOnWindowFocus: false,
		},
	);

	if (selectedOrganization && !isEnterprise) {
		return <MasterKeysContactSalesCard />;
	}

	const planLimits = data?.planLimits;
	const limitReached =
		planLimits && planLimits.currentCount >= planLimits.maxKeys;

	return (
		<div className="flex flex-col">
			<div className="flex flex-col space-y-4 p-4 pt-6 md:p-8">
				<div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0">
					<div>
						<h2 className="text-3xl font-bold tracking-tight">Master Keys</h2>
						<p className="text-muted-foreground">
							Manage master keys to create projects and gateway API keys
							programmatically via the /v1/master/* API.{" "}
							<a
								href="https://docs.llmgateway.io/features/master-keys"
								target="_blank"
								rel="noopener noreferrer"
								className="text-primary inline-flex items-center gap-1 underline-offset-4 hover:underline"
							>
								View docs
								<ExternalLink className="h-3 w-3" />
							</a>
						</p>
					</div>
					<CreateMasterKeyDialog
						organizationId={organizationId}
						disabled={limitReached}
						disabledMessage={
							limitReached
								? `Maximum ${planLimits?.maxKeys} master keys per organization`
								: undefined
						}
					>
						<Button
							disabled={limitReached}
							className="cursor-pointer flex items-center space-x-1 w-full md:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
						>
							<Orbit className="h-4 w-4 mt-0.5" />
							Create Master Key
						</Button>
					</CreateMasterKeyDialog>
				</div>
				<div className="space-y-4">
					<div className="hidden md:block">
						<Card className="gap-0">
							<CardHeader />
							<CardContent>
								<MasterKeysList organizationId={organizationId} />
							</CardContent>
						</Card>
					</div>
					<div className="md:hidden">
						<MasterKeysList organizationId={organizationId} />
					</div>
				</div>
			</div>
		</div>
	);
}
