"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { canWrite } from "@/lib/admin-role";
import { useAdminRole } from "@/lib/admin-role-context";
import { apiErrorMessage } from "@/lib/api-error";
import { useApi } from "@/lib/fetch-client";

import { formatNumber } from "@llmgateway/shared/number-format";

import type { paths } from "@/lib/api/v1";

type Listing =
	paths["/admin/airside/listings"]["get"]["responses"]["200"]["content"]["application/json"]["listings"][number];

const STATUS_VARIANT: Record<
	Listing["status"],
	"default" | "secondary" | "outline" | "destructive"
> = {
	active: "default",
	draft: "outline",
	rejected: "destructive",
	delisted: "secondary",
};

function ContextCell({ listing }: { listing: Listing }) {
	const window = listing.contextSize ? formatNumber(listing.contextSize) : "—";
	if (!listing.contextDeviation && !listing.autoRouteExcluded) {
		return <span className="font-mono text-xs">{window}</span>;
	}
	return (
		<div className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400">
			<AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
			<div>
				<div className="font-mono">
					{window}
					{listing.referenceContextSize
						? ` of ${formatNumber(listing.referenceContextSize)}`
						: ""}
				</div>
				<div>
					{listing.contextDeviation === "below"
						? "Below the model's window"
						: listing.contextDeviation === "above"
							? "Above every other deployment"
							: null}
					{listing.autoRouteExcluded ? " · skipped by bare-id routing" : ""}
				</div>
			</div>
		</div>
	);
}

/**
 * Airside listings with their context-window standing and an admin delist
 * action.
 */
export function AirsideListingsTable({ providerId }: { providerId?: string }) {
	const $api = useApi();
	const queryClient = useQueryClient();
	const editable = canWrite(useAdminRole());
	const [pending, setPending] = useState<Listing | null>(null);
	const query = $api.useQuery("get", "/admin/airside/listings", {
		params: {
			query: providerId ? { providerId } : {},
		},
	});
	const delist = $api.useMutation(
		"post",
		"/admin/airside/listings/{id}/delist",
		{
			onSuccess: async () => {
				toast.success("Listing delisted.");
				setPending(null);
				await queryClient.invalidateQueries({
					queryKey: ["get", "/admin/airside/listings"],
				});
			},
			onError: (error: unknown) => {
				toast.error(apiErrorMessage(error, "Delisting failed"));
			},
		},
	);

	if (query.isLoading) {
		return (
			<div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
				<Loader2 className="size-4 animate-spin" /> Loading listings…
			</div>
		);
	}
	const listings = query.data?.listings ?? [];
	if (listings.length === 0) {
		return <p className="p-4 text-sm text-muted-foreground">No listings.</p>;
	}

	return (
		<>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Model</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Context</TableHead>
						<TableHead>Listing / mappings</TableHead>
						<TableHead className="text-right">Action</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{listings.map((listing) => (
						<TableRow
							key={listing.id}
							data-testid={`airside-listing-${listing.id}`}
						>
							<TableCell className="font-mono text-sm">
								{listing.modelName}
							</TableCell>
							<TableCell>
								<Badge variant={STATUS_VARIANT[listing.status]}>
									{listing.status}
								</Badge>
								{listing.delistReason ? (
									<div className="text-xs text-muted-foreground">
										{listing.delistReason.replace("_", " ")}
									</div>
								) : null}
							</TableCell>
							<TableCell>
								<ContextCell listing={listing} />
							</TableCell>
							<TableCell className="font-mono text-xs text-muted-foreground">
								<div>{listing.id}</div>
								{listing.mappingIds.map((id) => (
									<div key={id}>{id}</div>
								))}
							</TableCell>
							<TableCell className="text-right">
								{listing.status === "active" && editable ? (
									<Button
										variant="destructive"
										size="sm"
										onClick={() => setPending(listing)}
									>
										Delist
									</Button>
								) : null}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
			<Dialog
				open={pending !== null}
				onOpenChange={(open) => {
					if (!open) {
						setPending(null);
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							Delist {pending?.providerId}/{pending?.modelName}?
						</DialogTitle>
						<DialogDescription>
							The listing stops routing immediately, its pending filings are
							rejected, and its fare override is removed. The carrier sees it as
							delisted by LLM Gateway and can relist once it meets the listing
							rules.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setPending(null)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							disabled={delist.isPending}
							onClick={() => {
								if (pending) {
									delist.mutate({ params: { path: { id: pending.id } } });
								}
							}}
						>
							{delist.isPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : null}
							Delist
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
