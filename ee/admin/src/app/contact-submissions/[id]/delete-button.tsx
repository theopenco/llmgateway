"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
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

export function DeleteSubmissionButton({ id }: { id: string }) {
	const $api = useApi();
	const queryClient = useQueryClient();
	const router = useRouter();
	const [open, setOpen] = useState(false);

	const deleteMutation = $api.useMutation(
		"delete",
		"/admin/contact-submissions/{id}",
		{
			onSuccess: () => {
				setOpen(false);
				void queryClient.invalidateQueries({
					queryKey: $api.queryOptions("get", "/admin/contact-submissions")
						.queryKey,
				});
				router.push("/contact-submissions");
			},
		},
	);

	return (
		<>
			<Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
				<Trash2 className="mr-2 h-3.5 w-3.5" />
				Delete
			</Button>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Submission</DialogTitle>
						<DialogDescription>
							This will permanently delete this contact submission. This action
							cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setOpen(false)}>
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
