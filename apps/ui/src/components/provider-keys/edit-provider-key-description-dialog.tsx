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
	DialogTrigger,
} from "@/lib/components/dialog";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

export function EditProviderKeyDescriptionDialog({
	providerKeyId,
	currentDescription,
	children,
}: {
	providerKeyId: string;
	currentDescription: string | null;
	children: React.ReactNode;
}) {
	const api = useApi();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [description, setDescription] = useState(currentDescription ?? "");
	const queryKey = api.queryOptions("get", "/keys/provider").queryKey;
	const updateMutation = api.useMutation("patch", "/keys/provider/{id}");

	const handleOpenChange = (next: boolean) => {
		setOpen(next);
		if (next) {
			setDescription(currentDescription ?? "");
		}
	};

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		const trimmed = description.trim();
		if (trimmed === (currentDescription ?? "")) {
			setOpen(false);
			return;
		}

		updateMutation.mutate(
			{
				params: { path: { id: providerKeyId } },
				body: { description: trimmed || null },
			},
			{
				onSuccess: () => {
					toast({
						title: "Description updated",
						description: trimmed
							? "New requests will use this label in routing details."
							: "The provider key description was removed.",
					});
					void queryClient.invalidateQueries({ queryKey });
					setOpen(false);
				},
				onError: () =>
					toast({
						title: "Error",
						description: "Failed to update the provider key description.",
						variant: "destructive",
					}),
			},
		);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>Edit key description</DialogTitle>
						<DialogDescription>
							Use a short label to recognize this key in request logs and
							routing details.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2 py-4">
						<Label htmlFor={`provider-key-description-${providerKeyId}`}>
							Description
						</Label>
						<Input
							id={`provider-key-description-${providerKeyId}`}
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							placeholder="Production workloads"
							maxLength={200}
						/>
					</div>
					<DialogFooter>
						<Button type="submit" disabled={updateMutation.isPending}>
							{updateMutation.isPending ? "Saving..." : "Save"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
