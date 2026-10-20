"use client";

import { useQueryClient } from "@tanstack/react-query";
import { PowerIcon, PowerOffIcon, Trash2Icon, XIcon } from "lucide-react";
import { useState } from "react";

import { getApiErrorMessage } from "@/lib/api-error";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/lib/components/alert-dialog";
import { Button } from "@/lib/components/button";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

import { formatApiKeyExpiry } from "./api-key-ttl-fields";

import type { ApiKey } from "@/lib/types";

export type BulkApiKeyAction = "deactivate" | "reactivate" | "delete";

const BULK_CHUNK_SIZE = 500;
const PREVIEW_COUNT = 5;

const pluralKeys = (count: number) =>
	`${count} API key${count === 1 ? "" : "s"}`;

function isExpired(key: ApiKey): boolean {
	return formatApiKeyExpiry(key.expiresAt)?.expired ?? false;
}

export function bulkActionEligibility(keys: ApiKey[]) {
	const active = keys.filter((key) => key.status === "active");
	const inactive = keys.filter((key) => key.status === "inactive");
	const expiredInactive = inactive.filter(isExpired);
	return {
		deactivate: active,
		reactivate: inactive.filter((key) => !isExpired(key)),
		expiredInactive,
		delete: keys,
	};
}

/**
 * Explains exactly what the header checkbox selected: only the rows on this
 * page, or every key matching the current filters across all pages.
 */
export function ApiKeysSelectionBanner({
	selectedCount,
	pageCount,
	viewCount,
	allPageSelected,
	allViewSelected,
	viewExceedsPage,
	onSelectView,
	onClear,
}: {
	selectedCount: number;
	pageCount: number;
	viewCount: number;
	allPageSelected: boolean;
	allViewSelected: boolean;
	viewExceedsPage: boolean;
	onSelectView: () => void;
	onClear: () => void;
}) {
	if (!selectedCount || !viewExceedsPage) {
		return null;
	}

	return (
		<div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-md bg-muted/50 px-3 py-2 text-sm">
			{allViewSelected ? (
				<>
					<span>
						All <strong>{viewCount}</strong> keys in this view are selected,
						including those on other pages.
					</span>
					<Button
						variant="link"
						size="sm"
						className="h-auto p-0 font-semibold underline underline-offset-4"
						onClick={onClear}
					>
						Clear selection
					</Button>
				</>
			) : allPageSelected && selectedCount === pageCount ? (
				<>
					<span>
						All <strong>{pageCount}</strong> keys on this page are selected.
					</span>
					<Button
						variant="link"
						size="sm"
						className="h-auto p-0 font-semibold underline underline-offset-4"
						onClick={onSelectView}
					>
						Select all {viewCount} keys in this view
					</Button>
				</>
			) : (
				<>
					<span>
						<strong>{selectedCount}</strong> of {viewCount} keys in this view
						selected.
					</span>
					<Button
						variant="link"
						size="sm"
						className="h-auto p-0 font-semibold underline underline-offset-4"
						onClick={onSelectView}
					>
						Select all {viewCount}
					</Button>
				</>
			)}
		</div>
	);
}

export function ApiKeysBulkActionBar({
	selectedKeys,
	onClear,
}: {
	selectedKeys: ApiKey[];
	onClear: () => void;
}) {
	const api = useApi();
	const queryClient = useQueryClient();
	const [pendingAction, setPendingAction] = useState<BulkApiKeyAction | null>(
		null,
	);
	const { mutateAsync, isPending } = api.useMutation("post", "/keys/api/bulk");

	if (!selectedKeys.length) {
		return null;
	}

	const eligibility = bulkActionEligibility(selectedKeys);
	const targets = pendingAction ? eligibility[pendingAction] : [];

	const run = async (action: BulkApiKeyAction, keys: ApiKey[]) => {
		const ids = keys.map((key) => key.id);
		let succeeded = 0;
		let skipped = 0;
		const failures = new Map<string, number>();

		try {
			for (let start = 0; start < ids.length; start += BULK_CHUNK_SIZE) {
				const result = await mutateAsync({
					body: { action, ids: ids.slice(start, start + BULK_CHUNK_SIZE) },
				});
				succeeded += result.succeeded.length;
				skipped += result.skipped.length;
				for (const failure of result.failed) {
					failures.set(
						failure.message,
						(failures.get(failure.message) ?? 0) + 1,
					);
				}
			}
		} catch (error) {
			toast({
				title: `Failed to ${action} API keys.`,
				description: getApiErrorMessage(error, "Please try again."),
				variant: "destructive",
			});
			return;
		} finally {
			void queryClient.invalidateQueries({ queryKey: ["get", "/keys/api"] });
		}

		const verb =
			action === "delete"
				? "deleted"
				: action === "deactivate"
					? "deactivated"
					: "reactivated";
		const details = [
			skipped ? `${pluralKeys(skipped)} already ${verb}` : null,
			...Array.from(failures).map(
				([message, count]) => `${pluralKeys(count)} not ${verb}: ${message}`,
			),
		].filter(Boolean);

		toast({
			title: `${pluralKeys(succeeded)} ${verb}`,
			description: details.length ? details.join(" ") : undefined,
			variant: failures.size && !succeeded ? "destructive" : "default",
		});
		setPendingAction(null);
		onClear();
	};

	const description = (() => {
		const count = pluralKeys(targets.length);
		switch (pendingAction) {
			case "deactivate":
				return `${count} will stop authenticating requests right away. You can reactivate them later.`;
			case "reactivate":
				return `${count} will authenticate requests again. Reactivation stops once your organization reaches its active API key limit.`;
			case "delete":
				return `${count} will be permanently deleted. Requests using them will fail, and this cannot be undone.`;
			default:
				return "";
		}
	})();

	const skippedNote = (() => {
		const notes: string[] = [];
		if (pendingAction === "deactivate") {
			const already = selectedKeys.length - targets.length;
			if (already) {
				notes.push(`${pluralKeys(already)} already inactive will be skipped.`);
			}
		}
		if (pendingAction === "reactivate") {
			const already = selectedKeys.filter(
				(key) => key.status === "active",
			).length;
			if (already) {
				notes.push(`${pluralKeys(already)} already active will be skipped.`);
			}
			if (eligibility.expiredInactive.length) {
				notes.push(
					`${pluralKeys(eligibility.expiredInactive.length)} with an expired TTL will be skipped. Reactivate those individually with a new expiration.`,
				);
			}
		}
		return notes;
	})();

	return (
		<>
			<div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 shadow-sm">
				<span className="text-sm font-medium">
					{selectedKeys.length} selected
				</span>
				<Button
					variant="ghost"
					size="sm"
					className="h-7 px-2"
					onClick={onClear}
				>
					<XIcon className="h-3.5 w-3.5" />
					Clear
				</Button>
				<div className="ml-auto flex flex-wrap gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={!eligibility.deactivate.length || isPending}
						onClick={() => setPendingAction("deactivate")}
					>
						<PowerOffIcon className="h-4 w-4" />
						Deactivate ({eligibility.deactivate.length})
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={!eligibility.reactivate.length || isPending}
						onClick={() => setPendingAction("reactivate")}
					>
						<PowerIcon className="h-4 w-4" />
						Reactivate ({eligibility.reactivate.length})
					</Button>
					<Button
						variant="destructive"
						size="sm"
						disabled={isPending}
						onClick={() => setPendingAction("delete")}
					>
						<Trash2Icon className="h-4 w-4" />
						Delete ({eligibility.delete.length})
					</Button>
				</div>
			</div>

			<AlertDialog
				open={pendingAction !== null}
				onOpenChange={(open) => {
					if (!open && !isPending) {
						setPendingAction(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{pendingAction === "delete"
								? `Delete ${pluralKeys(targets.length)}?`
								: pendingAction === "deactivate"
									? `Deactivate ${pluralKeys(targets.length)}?`
									: `Reactivate ${pluralKeys(targets.length)}?`}
						</AlertDialogTitle>
						<AlertDialogDescription>{description}</AlertDialogDescription>
					</AlertDialogHeader>
					<ul className="space-y-1 rounded-md border bg-muted/30 px-3 py-2 text-sm">
						{targets.slice(0, PREVIEW_COUNT).map((key) => (
							<li key={key.id} className="flex justify-between gap-3">
								<span className="truncate">{key.description}</span>
								<span className="font-mono text-xs text-muted-foreground">
									{key.maskedToken}
								</span>
							</li>
						))}
						{targets.length > PREVIEW_COUNT && (
							<li className="text-muted-foreground">
								and {targets.length - PREVIEW_COUNT} more
							</li>
						)}
					</ul>
					{skippedNote.length > 0 && (
						<p className="text-muted-foreground text-sm">
							{skippedNote.join(" ")}
						</p>
					)}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
						<Button
							variant={pendingAction === "delete" ? "destructive" : "default"}
							disabled={isPending || !targets.length}
							onClick={() => {
								if (pendingAction) {
									void run(pendingAction, targets);
								}
							}}
						>
							{isPending
								? "Working..."
								: pendingAction === "delete"
									? `Delete ${pluralKeys(targets.length)}`
									: pendingAction === "deactivate"
										? `Deactivate ${pluralKeys(targets.length)}`
										: `Reactivate ${pluralKeys(targets.length)}`}
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
