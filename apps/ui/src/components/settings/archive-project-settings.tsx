"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";

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
import { useApi } from "@/lib/fetch-client";

interface ArchiveProjectSettingsProps {
	orgId: string;
	projectId: string;
	projectName: string;
}

export function ArchiveProjectSettings({
	orgId,
	projectId,
	projectName,
}: ArchiveProjectSettingsProps) {
	const { toast } = useToast();
	const queryClient = useQueryClient();
	const router = useRouter();
	const [isDeleting, setIsDeleting] = React.useState(false);

	const api = useApi();

	const handleArchiveProject = async () => {
		try {
			setIsDeleting(true);

			await api.mutate("delete", "/projects/{id}", {
				params: { path: { id: projectId } },
			});

			// Invalidate relevant queries
			const queryKey = api.queryOptions("get", "/orgs/{id}/projects", {
				params: { path: { id: orgId } },
			}).queryKey;
			void queryClient.invalidateQueries({ queryKey });

			toast({
				title: "Project archived",
				description: "The project has been successfully archived.",
			});

			// Redirect to organization dashboard
			router.push(`/dashboard/${orgId}`);
		} catch {
			toast({
				title: "Error",
				description: "Failed to archive the project. Please try again.",
				variant: "destructive",
			});
		} finally {
			setIsDeleting(false);
		}
	};

	return (
		<div className="space-y-4">
			<div>
				<h3 className="text-lg font-medium">Archive Project</h3>
				<p className="text-muted-foreground text-sm">
					Permanently archive this project and all its data
				</p>
				<p className="text-muted-foreground text-sm mt-1">
					Project: {projectName}
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
								Archiving this project will:
							</p>
						</div>
						<ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside ml-2">
							<li>Remove the project from your project selector</li>
							<li>Disable all API keys associated with this project</li>
							<li>
								Preserve all historical data and logs for compliance purposes
							</li>
						</ul>
					</div>
				</div>

				<AlertDialog>
					<AlertDialogTrigger asChild>
						<Button variant="destructive" disabled={isDeleting}>
							Archive Project
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
							<AlertDialogDescription>
								This will archive "{projectName}" and remove it from your
								project selector. All API keys for this project will be
								disabled. While historical data will be preserved, the project
								will no longer be accessible.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								onClick={handleArchiveProject}
								disabled={isDeleting}
								className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							>
								{isDeleting ? "Archiving..." : "Archive Project"}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		</div>
	);
}
