"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApi } from "@/lib/fetch-client";

import type { Organization, Project } from "@/lib/types";
import type React from "react";

interface NewProjectDialogProps {
	isOpen: boolean;
	setIsOpen: (isOpen: boolean) => void;
	selectedOrganization: Organization | null;
	onProjectCreated: (project: Project) => void;
}

// Type for the projects query response data
interface ProjectsQueryData {
	projects: Project[];
}

export function NewProjectDialog({
	isOpen,
	setIsOpen,
	selectedOrganization,
	onProjectCreated,
}: NewProjectDialogProps) {
	const [projectName, setProjectName] = useState("");

	const queryClient = useQueryClient();
	const api = useApi();
	const createProjectMutation = api.useMutation("post", "/projects", {
		onSuccess: (data) => {
			// Update the projects cache for the current organization
			if (selectedOrganization) {
				const queryKey = api.queryOptions("get", "/orgs/{id}/projects", {
					params: { path: { id: selectedOrganization.id } },
				}).queryKey;

				queryClient.setQueryData(
					queryKey,
					(oldData: ProjectsQueryData | undefined) => {
						if (!oldData) {
							return { projects: [data.project] };
						}
						return {
							...oldData,
							projects: [...oldData.projects, data.project],
						};
					},
				);
			}

			// Show success toast
			toast("Project created successfully", {
				description: `${data.project.name} has been created.`,
			});
		},
		onError: (error) => {
			// Check if it's a max projects limit error
			if (
				error.message?.includes("maximum") ||
				error.message?.includes("limit")
			) {
				toast("Project limit reached", {
					description:
						"You've reached the maximum number of projects for your plan. Please contact us to upgrade to Enterprise.",
					style: {
						backgroundColor: "var(--destructive)",
						color: "var(--destructive-foreground)",
					},
				});
			} else {
				// Generic error toast
				toast("Failed to create project", {
					description:
						error.message || "An unexpected error occurred. Please try again.",
					style: {
						backgroundColor: "var(--destructive)",
						color: "var(--destructive-foreground)",
					},
				});
			}
		},
	});

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (
			!projectName.trim() ||
			!selectedOrganization ||
			createProjectMutation.isPending
		) {
			return;
		}

		try {
			const result = await createProjectMutation.mutateAsync({
				body: {
					name: projectName.trim(),
					organizationId: selectedOrganization.id,
				},
			});

			if (result.project) {
				onProjectCreated(result.project);
				setProjectName("");
				setIsOpen(false);
			}
		} catch (error) {
			// Error is already handled by the mutation's onError callback
			// But we can add additional logging if needed
			console.error("Failed to create project:", error);
		}
	};

	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<DialogContent className="sm:max-w-[425px]">
				<DialogHeader>
					<DialogTitle>Create New Project</DialogTitle>
					<DialogDescription>
						Create a new project in{" "}
						<span className="font-medium">
							{selectedOrganization?.name || "the selected organization"}
						</span>
						.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit}>
					<div className="grid gap-4 py-4">
						<div className="grid grid-cols-4 items-center gap-4">
							<Label htmlFor="project-name" className="text-right">
								Name
							</Label>
							<Input
								id="project-name"
								value={projectName}
								onChange={(e) => setProjectName(e.target.value)}
								className="col-span-3"
								placeholder="My Project"
								disabled={createProjectMutation.isPending}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							onClick={() => setIsOpen(false)}
							disabled={createProjectMutation.isPending}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={
								createProjectMutation.isPending ||
								!projectName.trim() ||
								!selectedOrganization
							}
						>
							{createProjectMutation.isPending
								? "Creating..."
								: "Create Project"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
