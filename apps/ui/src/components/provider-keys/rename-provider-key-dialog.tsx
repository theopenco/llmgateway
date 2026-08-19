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

import {
	CUSTOM_PROVIDER_NAME_MESSAGE,
	CUSTOM_PROVIDER_NAME_REGEX,
} from "@llmgateway/shared";

export function RenameProviderKeyDialog({
	providerKeyId,
	currentName,
	children,
}: {
	providerKeyId: string;
	currentName: string | null;
	children: React.ReactNode;
}) {
	const api = useApi();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState(currentName ?? "");

	const queryKey = api.queryOptions("get", "/keys/provider").queryKey;
	const renameMutation = api.useMutation("patch", "/keys/provider/{id}");

	const handleOpenChange = (next: boolean) => {
		setOpen(next);
		if (next) {
			setName(currentName ?? "");
		}
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();

		const trimmed = name.trim();
		if (!CUSTOM_PROVIDER_NAME_REGEX.test(trimmed)) {
			toast({
				title: "Invalid name",
				description: CUSTOM_PROVIDER_NAME_MESSAGE,
				variant: "destructive",
			});
			return;
		}
		if (trimmed === currentName) {
			setOpen(false);
			return;
		}

		renameMutation.mutate(
			{ params: { path: { id: providerKeyId } }, body: { name: trimmed } },
			{
				onSuccess: () => {
					toast({
						title: "Custom provider renamed",
						description: `Requests must now use the ${trimmed}/ model prefix.`,
					});
					void queryClient.invalidateQueries({ queryKey });
					setOpen(false);
				},
				onError: (error: unknown) =>
					toast({
						title: "Error",
						description:
							error instanceof Error
								? error.message
								: "Failed to rename custom provider",
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
						<DialogTitle>Rename custom provider</DialogTitle>
						<DialogDescription>
							The name is the model prefix for requests through this provider
							(e.g.{" "}
							<code className="font-mono">
								{currentName ?? "my-provider"}/some-model
							</code>
							). Renaming takes effect immediately, so requests still using the
							old prefix will fail.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2 py-4">
						<Label htmlFor="rename-provider-name">Name</Label>
						<Input
							id="rename-provider-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="my-provider"
						/>
					</div>
					<DialogFooter>
						<Button type="submit" disabled={renameMutation.isPending}>
							{renameMutation.isPending ? "Renaming..." : "Rename"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
