"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";

import { getApiErrorMessage } from "@/lib/api-error";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/lib/components/alert-dialog";
import { Button } from "@/lib/components/button";
import { Separator } from "@/lib/components/separator";
import { useToast } from "@/lib/components/use-toast";
import { useDashboardContext } from "@/lib/dashboard-context";
import { useApi } from "@/lib/fetch-client";

export function DeleteOrganizationSettings() {
	const { toast } = useToast();
	const queryClient = useQueryClient();
	const router = useRouter();
	const { selectedOrganization } = useDashboardContext();

	const api = useApi();
	const orgId = selectedOrganization?.id ?? "";
	const isOwner = selectedOrganization?.role === "owner";

	const {
		data: eligibility,
		isLoading,
		error: eligibilityError,
		refetch: refetchEligibility,
	} = api.useQuery(
		"get",
		"/orgs/{id}/deletion-eligibility",
		{ params: { path: { id: orgId } } },
		{ enabled: Boolean(orgId) && isOwner },
	);

	const deleteOrganization = api.useMutation("delete", "/orgs/{id}", {
		onSuccess: async () => {
			const queryKey = api.queryOptions("get", "/orgs").queryKey;
			await queryClient.invalidateQueries({ queryKey });

			toast({
				title: "Organization deleted",
				description: "The organization has been deleted.",
			});

			router.push("/dashboard");
		},
		onError: (error) => {
			toast({
				title: "Could not delete organization",
				description: getApiErrorMessage(
					error,
					"Failed to delete the organization.",
				),
				variant: "destructive",
			});
		},
	});

	if (!selectedOrganization) {
		return null;
	}

	if (!isOwner) {
		return (
			<p className="text-muted-foreground text-sm">
				Only organization owners can delete an organization.
			</p>
		);
	}

	const blockedByCredits = eligibility?.blockingCredits ?? false;
	const blockedByUsage = eligibility?.recentActivity ?? false;
	const idleDays = eligibility?.idleDays ?? 30;
	const maxCredits = eligibility?.maxCredits ?? 5;
	const canDelete = eligibility?.canDelete ?? false;
	const disabled = isLoading || !canDelete || deleteOrganization.isPending;

	const handleDelete = async () => {
		await deleteOrganization.mutateAsync({
			params: { path: { id: selectedOrganization.id } },
		});
	};

	return (
		<div className="space-y-4">
			<div>
				<h3 className="text-lg font-medium">Delete Organization</h3>
				<p className="text-muted-foreground text-sm">
					Permanently delete this organization, all its projects and API keys
				</p>
				<p className="text-muted-foreground text-sm mt-1">
					Organization: {selectedOrganization.name}
				</p>
			</div>

			<Separator />

			<div className="space-y-4">
				<div className="rounded-md border border-destructive/20 bg-destructive/5 p-4">
					<div className="space-y-3">
						<div>
							<h4 className="text-sm font-medium text-destructive">
								This action cannot be undone
							</h4>
							<p className="text-sm text-muted-foreground mt-1">
								Deleting this organization will:
							</p>
						</div>
						<ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside ml-2">
							<li>Remove it for every member</li>
							<li>Disable all projects and API keys</li>
							<li>Cancel any active subscription</li>
							<li>
								Preserve historical usage data and logs for compliance purposes
							</li>
						</ul>
					</div>
				</div>

				{blockedByCredits && (
					<p className="text-sm text-muted-foreground">
						This organization still holds a credit balance of ${maxCredits} or
						more, so it cannot be deleted from here. Please contact support at{" "}
						<a
							href="mailto:contact@llmgateway.io"
							className="font-medium underline underline-offset-2 whitespace-nowrap"
						>
							contact@llmgateway.io
						</a>{" "}
						to close it.
					</p>
				)}

				{blockedByUsage && (
					<p className="text-sm text-muted-foreground">
						This organization had spend activity within the last {idleDays}{" "}
						days. Stop all traffic and come back once it has been idle for{" "}
						{idleDays} days.
					</p>
				)}

				{eligibilityError && !eligibility && (
					<div className="flex flex-wrap items-center gap-3">
						<p className="text-sm text-destructive">
							{getApiErrorMessage(
								eligibilityError,
								"Could not check whether this organization can be deleted.",
							)}
						</p>
						<Button
							variant="outline"
							size="sm"
							onClick={() => void refetchEligibility()}
						>
							Retry
						</Button>
					</div>
				)}

				<AlertDialog>
					<AlertDialogTrigger asChild>
						<Button variant="destructive" disabled={disabled}>
							Delete Organization
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
							<AlertDialogDescription>
								This will permanently delete "{selectedOrganization.name}" for
								all members, disable every project and API key, and cancel any
								active subscription. Historical data is preserved, but the
								organization will no longer be accessible.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								onClick={handleDelete}
								disabled={deleteOrganization.isPending}
								className="bg-destructive text-white hover:bg-destructive/90"
							>
								{deleteOrganization.isPending
									? "Deleting..."
									: "Delete Organization"}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		</div>
	);
}
