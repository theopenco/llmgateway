"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useApi } from "@/lib/fetch-client";

export function DeleteSubmissionButton({
	id,
	archivedAt,
}: {
	id: string;
	archivedAt: string | null;
}) {
	const $api = useApi();
	const queryClient = useQueryClient();
	const router = useRouter();
	const [deleteOpen, setDeleteOpen] = useState(false);

	const invalidate = () => {
		void queryClient.invalidateQueries({
			queryKey: $api.queryOptions("get", "/admin/contact-submissions").queryKey,
		});
	};

	const deleteMutation = $api.useMutation(
		"delete",
		"/admin/contact-submissions/{id}",
		{
			onSuccess: () => {
				setDeleteOpen(false);
				invalidate();
				router.push("/contact-submissions");
			},
		},
	);

	const archiveMutation = $api.useMutation(
		"patch",
		"/admin/contact-submissions/{id}/archive",
		{
			onSuccess: () => {
				invalidate();
				void queryClient.invalidateQueries({
					queryKey: $api.queryOptions(
						"get",
						"/admin/contact-submissions/{id}",
						{ params: { path: { id } } },
					).queryKey,
				});
				router.refresh();
			},
		},
	);

	const isArchived = !!archivedAt;

	return (
		<>
			<Button
				variant="outline"
				size="sm"
				disabled={archiveMutation.isPending}
				onClick={() => {
					archiveMutation.mutate({
						params: { path: { id } },
						body: { archived: !isArchived },
					});
				}}
			>
				{isArchived ? (
					<ArchiveRestore className="mr-2 h-3.5 w-3.5" />
				) : (
					<Archive className="mr-2 h-3.5 w-3.5" />
				)}
				{isArchived ? "Unarchive" : "Archive"}
			</Button>

			<Button
				variant="destructive"
				size="sm"
				onClick={() => setDeleteOpen(true)}
			>
				<Trash2 className="mr-2 h-3.5 w-3.5" />
				Delete
			</Button>

			<Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Submission</DialogTitle>
						<DialogDescription>
							This will permanently delete this contact submission. This action
							cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDeleteOpen(false)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							disabled={deleteMutation.isPending}
							onClick={() => {
								deleteMutation.mutate({
									params: { path: { id } },
								});
							}}
						>
							{deleteMutation.isPending ? "Deleting..." : "Delete"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
