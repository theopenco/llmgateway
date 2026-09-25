"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";

import { SmartRoutingSettings } from "@/components/settings/smart-routing-settings";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { useTeamMembers } from "@/hooks/useTeam";
import { useUser } from "@/hooks/useUser";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

import { isOrganizationAdmin } from "@llmgateway/shared/organization-roles";

import { SmartRoutingContactSalesCard } from "./contact-sales-card";

import type { SmartRoutingConfig } from "@llmgateway/shared/smart-routing";

export function SmartRoutingClient() {
	const params = useParams();
	const organizationId = params.orgId as string;
	const { selectedOrganization } = useDashboardNavigation();
	const { user } = useUser();
	const { data: teamData, isLoading: isLoadingTeam } =
		useTeamMembers(organizationId);
	const queryClient = useQueryClient();

	const api = useApi();
	const updateOrganization = api.useMutation("patch", "/orgs/{id}", {
		onSuccess: () => {
			const queryKey = api.queryOptions("get", "/orgs").queryKey;
			void queryClient.invalidateQueries({ queryKey });
		},
	});

	const role = teamData?.members.find(
		(member) => member.userId === user?.id,
	)?.role;
	const isAdmin = isOrganizationAdmin(role);
	const savedConfig =
		(selectedOrganization?.smartRoutingConfig as SmartRoutingConfig | null) ??
		null;

	const save = async (config: SmartRoutingConfig | null) => {
		try {
			await updateOrganization.mutateAsync({
				params: { path: { id: organizationId } },
				body: { smartRoutingConfig: config },
			});
			toast({
				title: "Settings saved",
				description: config
					? "Your smart routing configuration has been updated."
					: "Smart routing now uses the default models.",
			});
		} catch {
			toast({
				title: "Error",
				description: "Failed to save smart routing settings.",
				variant: "destructive",
			});
		}
	};

	if (isLoadingTeam) {
		return (
			<div className="flex items-center justify-center py-12">
				<div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
			</div>
		);
	}

	// Free for every organization while in beta; DevPass has its own routing.
	if (selectedOrganization?.kind === "devpass") {
		return <SmartRoutingContactSalesCard />;
	}

	if (!isAdmin) {
		return (
			<div className="flex flex-col">
				<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
					<Card>
						<CardHeader>
							<CardTitle>Access Denied</CardTitle>
							<CardDescription>
								Only organization owners and admins can configure smart routing.
							</CardDescription>
						</CardHeader>
					</Card>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="max-w-3xl space-y-6">
					<div>
						<h2 className="text-2xl md:text-3xl font-bold tracking-tight">
							Smart Routing
						</h2>
						<p className="text-sm text-muted-foreground">
							Configure which models the <code className="text-xs">auto</code>{" "}
							model may resolve to, for every project in this organization.
						</p>
					</div>

					<Card>
						<CardHeader>
							<CardTitle>Organization default</CardTitle>
							<CardDescription>
								Projects inherit this configuration unless they override it on
								their own routing settings page.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-6">
							<SmartRoutingSettings
								value={savedConfig}
								canManage
								isSaving={updateOrganization.isPending}
								onSave={save}
							/>
							{savedConfig ? (
								<div className="flex justify-end border-t pt-4">
									<Button
										variant="ghost"
										disabled={updateOrganization.isPending}
										onClick={() => void save(null)}
									>
										Reset to default models
									</Button>
								</div>
							) : null}
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
