"use client";

import { format } from "date-fns";
import { History } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { useApi } from "@/lib/fetch-client";

/**
 * History of the worker's daily model sync for one managed credential: which
 * models each run enabled, and why the others are still unavailable.
 */
export function ProviderKeyModelSyncDialog({
	providerKeyId,
	label,
}: {
	providerKeyId: string;
	label: string;
}) {
	const [open, setOpen] = useState(false);
	const $api = useApi();

	const { data, isLoading } = $api.useQuery(
		"get",
		"/admin/provider-credentials/{id}/model-sync-history",
		{ params: { path: { id: providerKeyId } } },
		// The dialog is rendered once per row; only fetch for the one that opens.
		{ enabled: open },
	);
	const entries = data?.entries ?? [];

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					title="Model sync history"
					aria-label={`View model sync history for ${label}`}
				>
					<History className="h-4 w-4" />
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Model sync — {label}</DialogTitle>
					<DialogDescription>
						Once a day, every model this credential does not allow yet is tested
						and enabled if the account now serves it. Models are never removed
						automatically.
					</DialogDescription>
				</DialogHeader>

				{isLoading ? (
					<div className="h-40 animate-pulse rounded-md bg-muted" />
				) : entries.length === 0 ? (
					<p className="py-10 text-center text-sm text-muted-foreground">
						No sync has run for this credential yet.
					</p>
				) : (
					<ul className="max-h-[60vh] space-y-3 overflow-y-auto">
						{entries.map((entry) => (
							<li key={entry.id} className="rounded-md border p-3 text-sm">
								<div className="flex items-center justify-between gap-2">
									<span className="font-medium">
										{format(new Date(entry.createdAt), "MMM d, yyyy HH:mm")}
									</span>
									<span className="text-xs text-muted-foreground">
										{entry.probed} tested · {entry.added.length} enabled ·{" "}
										{entry.failed.length} unavailable
									</span>
								</div>
								{entry.added.length > 0 && (
									<div className="mt-2 flex flex-wrap gap-1">
										{entry.added.map((model) => (
											<Badge
												key={model}
												variant="secondary"
												className="font-mono text-[11px]"
											>
												+ {model}
											</Badge>
										))}
									</div>
								)}
								{entry.failed.length > 0 && (
									<details className="mt-2 text-xs text-muted-foreground">
										<summary className="cursor-pointer">
											Unavailable models
										</summary>
										<ul className="mt-1 space-y-1">
											{entry.failed.map((failure) => (
												<li key={failure.model}>
													<span className="font-mono">{failure.model}</span>
													{failure.statusCode ? ` (${failure.statusCode})` : ""}
													{failure.error ? ` — ${failure.error}` : ""}
												</li>
											))}
										</ul>
									</details>
								)}
							</li>
						))}
					</ul>
				)}
			</DialogContent>
		</Dialog>
	);
}
