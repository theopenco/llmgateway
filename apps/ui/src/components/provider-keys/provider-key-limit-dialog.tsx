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
	parseProviderKeyRateLimitInputs,
	ProviderKeyRateLimitFields,
	toProviderKeyRateLimitInputs,
	type ProviderKeyRateLimits,
} from "@llmgateway/shared/components";

const NON_NEGATIVE_DECIMAL_REGEX = /^\d+(?:\.\d+)?$/;

export function ProviderKeyLimitDialog({
	providerKeyId,
	currentLimit,
	currentUsage,
	currentRateLimits,
	children,
}: {
	providerKeyId: string;
	currentLimit: string | null;
	currentUsage: string;
	currentRateLimits: ProviderKeyRateLimits;
	children: React.ReactNode;
}) {
	const api = useApi();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [limit, setLimit] = useState(currentLimit ?? "");
	const [rateLimits, setRateLimits] = useState(() =>
		toProviderKeyRateLimitInputs(currentRateLimits),
	);

	const queryKey = api.queryOptions("get", "/keys/provider").queryKey;
	const limitMutation = api.useMutation("patch", "/keys/provider/{id}");

	const handleOpenChange = (next: boolean) => {
		setOpen(next);
		if (next) {
			setLimit(currentLimit ?? "");
			setRateLimits(toProviderKeyRateLimitInputs(currentRateLimits));
		}
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();

		const trimmed = limit.trim();
		if (trimmed && !NON_NEGATIVE_DECIMAL_REGEX.test(trimmed)) {
			toast({
				title: "Invalid limit",
				description: "Max spend must be a non-negative number.",
				variant: "destructive",
			});
			return;
		}
		const parsedRateLimits = parseProviderKeyRateLimitInputs(rateLimits);
		if ("error" in parsedRateLimits) {
			toast({
				title: "Invalid limit",
				description: parsedRateLimits.error,
				variant: "destructive",
			});
			return;
		}

		limitMutation.mutate(
			{
				params: { path: { id: providerKeyId } },
				body: { usageLimit: trimmed || null, ...parsedRateLimits.limits },
			},
			{
				onSuccess: () => {
					toast({ title: "Limits updated" });
					void queryClient.invalidateQueries({ queryKey });
					setOpen(false);
				},
				onError: (error: unknown) =>
					toast({
						title: "Error",
						description:
							error instanceof Error
								? error.message
								: ((error as { message?: string } | undefined)?.message ??
									"Failed to update limits"),
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
						<DialogTitle>Limits</DialogTitle>
						<DialogDescription>
							Spend and rate limits for this key.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2 py-4">
						<Label htmlFor="provider-key-limit">Max spend (USD)</Label>
						<div className="relative">
							<span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
								$
							</span>
							<Input
								id="provider-key-limit"
								className="pl-6"
								type="number"
								min={0}
								step="0.01"
								placeholder="No limit"
								value={limit}
								onChange={(e) => setLimit(e.target.value)}
							/>
						</div>
						<p className="text-xs text-muted-foreground">
							Security fuse: once the spend attributed to this key reaches the
							limit, it is automatically disabled (with a few seconds of lag).
							Spent so far: ${Number(currentUsage).toFixed(2)}. Leave empty to
							remove the limit.
						</p>
					</div>
					<div className="pb-4">
						<ProviderKeyRateLimitFields
							idPrefix={`provider-key-${providerKeyId}`}
							values={rateLimits}
							onChange={setRateLimits}
							disabled={limitMutation.isPending}
						/>
					</div>
					<DialogFooter>
						<Button type="submit" disabled={limitMutation.isPending}>
							{limitMutation.isPending ? "Saving..." : "Save"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
