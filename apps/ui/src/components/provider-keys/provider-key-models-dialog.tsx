"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

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
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

import { getProviderModelIds } from "@llmgateway/shared";
import { MultiModelIdSelector } from "@llmgateway/shared/components";

export function ProviderKeyModelsDialog({
	providerKeyId,
	provider,
	currentAllowedModels,
	children,
}: {
	providerKeyId: string;
	provider: string;
	currentAllowedModels: string[] | null;
	children: React.ReactNode;
}) {
	const api = useApi();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [allowedModels, setAllowedModels] = useState<string[]>(
		currentAllowedModels ?? [],
	);

	const queryKey = api.queryOptions("get", "/keys/provider").queryKey;
	const updateMutation = api.useMutation("patch", "/keys/provider/{id}");

	const availableIds = useMemo(() => getProviderModelIds(provider), [provider]);

	const handleOpenChange = (next: boolean) => {
		setOpen(next);
		if (next) {
			setAllowedModels(currentAllowedModels ?? []);
		}
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();

		updateMutation.mutate(
			{
				params: { path: { id: providerKeyId } },
				// An emptied list clears the restriction rather than storing a key
				// that can serve nothing.
				body: {
					allowedModels: allowedModels.length > 0 ? allowedModels : null,
				},
			},
			{
				onSuccess: () => {
					toast({
						title: "Allowed models updated",
						description:
							allowedModels.length > 0
								? `This key will only be used for ${allowedModels.length} model${allowedModels.length === 1 ? "" : "s"}.`
								: "This key can now be used for every model of the provider.",
					});
					void queryClient.invalidateQueries({ queryKey });
					setOpen(false);
				},
				onError: (error: unknown) =>
					toast({
						title: "Error",
						// Surface the server's message: it names the model ids the
						// provider's catalogue does not have.
						description:
							error instanceof Error
								? error.message
								: ((error as { message?: string } | undefined)?.message ??
									"Failed to update allowed models"),
						variant: "destructive",
					}),
			},
		);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>Allowed models</DialogTitle>
						<DialogDescription>
							Restrict this key to the models your provider account actually has
							access to, so requests for anything else never reach it.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2 py-4">
						<MultiModelIdSelector
							availableIds={availableIds}
							value={allowedModels}
							onChange={setAllowedModels}
							placeholder="All models (no restriction)"
						/>
						<p className="text-xs text-muted-foreground">
							{allowedModels.length === 0
								? "Empty means the key serves every model of this provider. Paste a comma-separated list to fill it quickly."
								: `Routing only uses this key for the ${allowedModels.length === 1 ? "listed model" : `${allowedModels.length} listed models`}. In hybrid mode, other models fall back to credits instead of failing.`}
						</p>
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
