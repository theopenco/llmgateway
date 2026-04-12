"use client";

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
import { useFetchClient } from "@/lib/fetch-client";

export function DeleteSubmissionButton({ id }: { id: string }) {
	const $fetch = useFetchClient();
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [deleting, setDeleting] = useState(false);

	const handleDelete = async () => {
		setDeleting(true);
		await $fetch.DELETE("/admin/contact-submissions/{id}", {
			params: { path: { id } },
		});
		setDeleting(false);
		setOpen(false);
		router.push("/contact-submissions");
	};

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
							disabled={deleting}
							onClick={handleDelete}
						>
							{deleting ? "Deleting..." : "Delete"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
