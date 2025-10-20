"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/lib/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/lib/components/dialog";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

import type { Organization } from "@/lib/types";
import type React from "react";

interface NewOrganizationDialogProps {
	isOpen: boolean;
	setIsOpen: (isOpen: boolean) => void;
	onOrganizationCreated: (organization: Organization) => void;
}

export function NewOrganizationDialog({
	isOpen,
	setIsOpen,
	onOrganizationCreated,
}: NewOrganizationDialogProps) {
	const [orgName, setOrgName] = useState("");
	const api = useApi();

	const queryClient = useQueryClient();
	const createOrgMutation = api.useMutation("post", "/orgs", {
		onSuccess: (data) => {
			// Update the organizations cache
			const queryKey = api.queryOptions("get", "/orgs").queryKey;
			queryClient.setQueryData(
				queryKey,
				(oldData: { organizations: Organization[] }) => {
					if (!oldData) {
						return { organizations: [data.organization] };
					}
					return {
						...oldData,
						organizations: [...oldData.organizations, data.organization],
					};
				},
			);

			// Invalidate the organizations query to ensure all components get the updated data
			queryClient.invalidateQueries({ queryKey });

			// Invalidate projects cache for the new organization since a default project is created
			const projectsQueryKey = api.queryOptions("get", "/orgs/{id}/projects", {
				params: { path: { id: data.organization.id } },
			}).queryKey;
			queryClient.invalidateQueries({ queryKey: projectsQueryKey });

			// Also invalidate all activity queries to ensure they refresh with the new organization/project
			queryClient.invalidateQueries({
				queryKey: ["GET", "/activity"],
				exact: false,
			});

			// Show success toast
			toast({
				title: "Organization created successfully",
				description: `${data.organization.name} has been created.`,
			});
		},
		onError: (error: any) => {
			const errorMessage =
				error?.error?.message ||
				error?.message ||
				(error instanceof Error
					? error.message
					: "An unexpected error occurred. Please try again.");

			// Check if it's a max organizations limit error
			if (errorMessage.includes("maximum") || errorMessage.includes("limit")) {
				toast({
					title: "Organization limit reached",
					description:
						"You've reached the maximum number of organizations for your plan. Please contact us to upgrade to Enterprise.",
					variant: "destructive",
				});
			} else {
				// Generic error toast
				toast({
					title: "Failed to create organization",
					description: errorMessage,
					variant: "destructive",
				});
			}
		},
	});

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!orgName.trim() || createOrgMutation.isPending) {
			return;
		}

		const result = await createOrgMutation.mutateAsync({
			body: {
				name: orgName.trim(),
			},
		});

		if (result.organization) {
			onOrganizationCreated(result.organization);
			setOrgName("");
			setIsOpen(false);
		}
	};

	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<DialogContent className="sm:max-w-[425px]">
				<DialogHeader>
					<DialogTitle>Create New Organization</DialogTitle>
					<DialogDescription>
						Create a new organization to group your projects.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit}>
					<div className="grid gap-4 py-4">
						<div className="grid grid-cols-4 items-center gap-4">
							<Label htmlFor="org-name" className="text-right">
								Name
							</Label>
							<Input
								id="org-name"
								value={orgName}
								onChange={(e) => setOrgName(e.target.value)}
								className="col-span-3"
								placeholder="Acme Inc."
								disabled={createOrgMutation.isPending}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							onClick={() => setIsOpen(false)}
							disabled={createOrgMutation.isPending}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={createOrgMutation.isPending || !orgName.trim()}
						>
							{createOrgMutation.isPending
								? "Creating..."
								: "Create Organization"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
