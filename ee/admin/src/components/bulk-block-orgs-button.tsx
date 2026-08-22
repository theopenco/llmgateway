"use client";

import {
	AlertTriangle,
	Loader2,
	MoreHorizontal,
	ShieldBan,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { BulkBlockPreview } from "@/lib/admin-organizations";

interface BulkBlockResult {
	success: boolean;
	error?: string;
	blockedCount?: number;
	failedCount?: number;
	failed?: { id: string; name: string; error: string }[];
}

interface BulkBlockOrgsButtonProps {
	search: string;
	minSearchLength: number;
	onPreview: (search: string) => Promise<{
		success: boolean;
		error?: string;
		preview?: BulkBlockPreview;
	}>;
	onBulkBlock: (
		search: string,
		expectedCount: number,
	) => Promise<BulkBlockResult>;
}

export function BulkBlockOrgsButton({
	search,
	minSearchLength,
	onPreview,
	onBulkBlock,
}: BulkBlockOrgsButtonProps) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [preview, setPreview] = useState<BulkBlockPreview | null>(null);
	const [confirmation, setConfirmation] = useState("");
	const [blocking, setBlocking] = useState(false);
	// Preview and block failures are tracked separately: a failed block re-resolves
	// the preview, and that reload must not clear the block error it accompanies.
	const [previewError, setPreviewError] = useState<string | null>(null);
	const [blockError, setBlockError] = useState<string | null>(null);
	const [result, setResult] = useState<BulkBlockResult | null>(null);

	const trimmedSearch = search.trim();
	const searchTooShort = trimmedSearch.length < minSearchLength;

	const resetState = () => {
		setPreview(null);
		setConfirmation("");
		setPreviewError(null);
		setBlockError(null);
		setResult(null);
		setPreviewLoading(false);
	};

	const loadPreview = async () => {
		setPreview(null);
		setConfirmation("");
		setPreviewError(null);
		setPreviewLoading(true);
		try {
			const response = await onPreview(trimmedSearch);
			if (response.success && response.preview) {
				setPreview(response.preview);
			} else {
				setPreviewError(response.error ?? "Failed to preview bulk block");
			}
		} catch (err) {
			setPreviewError(
				err instanceof Error ? err.message : "Failed to preview bulk block",
			);
		} finally {
			setPreviewLoading(false);
		}
	};

	const handleOpen = async () => {
		resetState();
		setOpen(true);
		await loadPreview();
	};

	const handleConfirm = async () => {
		if (!preview) {
			return;
		}
		setBlocking(true);
		setBlockError(null);
		try {
			const response = await onBulkBlock(preview.search, preview.blockable);
			if (response.success) {
				setResult(response);
				router.refresh();
				return;
			}
			setBlockError(response.error ?? "Failed to bulk block organizations");
		} catch (err) {
			setBlockError(
				err instanceof Error
					? err.message
					: "Failed to bulk block organizations",
			);
		} finally {
			setBlocking(false);
		}
		// Only reached when the block failed — the success path returns above. The
		// dialog stays on the confirmation step instead of showing a summary, and
		// re-resolving the set makes the admin confirm against current numbers
		// rather than resubmitting a stale one. This also covers a thrown request:
		// it may still have been applied server-side before the connection failed.
		await loadPreview();
	};

	// The admin has to retype the exact number of organizations the server
	// resolved. A stale or mistyped number leaves the confirm button disabled,
	// and the server independently re-checks the same number before blocking.
	const confirmationMatches =
		preview !== null &&
		preview.blockable > 0 &&
		confirmation.trim() === String(preview.blockable);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="outline"
						size="icon-sm"
						aria-label="Organization actions"
						title="Organization actions"
					>
						<MoreHorizontal className="h-4 w-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem
						variant="destructive"
						disabled={searchTooShort}
						onSelect={() => void handleOpen()}
						title={
							searchTooShort
								? `Search for at least ${minSearchLength} characters to enable this action`
								: undefined
						}
					>
						<ShieldBan />
						Block filtered organizations
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<Dialog
				open={open}
				onOpenChange={(next) => {
					if (blocking) {
						return;
					}
					setOpen(next);
					if (!next) {
						resetState();
					}
				}}
			>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<AlertTriangle className="h-5 w-5 text-destructive" />
							Bulk block filtered organizations
						</DialogTitle>
						<DialogDescription>
							Blocking cancels every active Stripe subscription, marks each
							organization as deleted, and deactivates every member.
							Organizations with a positive credit balance are never included —
							handle those manually.
						</DialogDescription>
					</DialogHeader>

					{previewLoading && (
						<div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
							<Loader2 className="h-4 w-4 animate-spin" />
							Resolving the organizations this would affect…
						</div>
					)}

					{!previewLoading && preview && !result && (
						<div className="space-y-4">
							<div className="rounded-md border border-border/60 bg-muted/40 p-3 text-sm">
								<p>
									Filter <code className="font-mono">{preview.search}</code>{" "}
									matches <strong>{preview.matched}</strong> organization(s).
								</p>
								<p className="mt-1">
									<strong className="text-destructive">
										{preview.blockable}
									</strong>{" "}
									will be blocked.
									{preview.skipped > 0 && (
										<>
											{" "}
											{preview.skipped} skipped (already blocked, still holding
											credits, or your own organizations).
										</>
									)}
								</p>
							</div>

							{preview.blockable === 0 ? (
								<p className="text-sm text-muted-foreground">
									Nothing to block for this filter.
								</p>
							) : (
								<>
									<div className="max-h-64 overflow-y-auto rounded-md border border-border/60">
										<ul className="divide-y divide-border/60 text-sm">
											{preview.organizations.map((org) => (
												<li
													key={org.id}
													className="flex items-center justify-between gap-3 px-3 py-2"
												>
													<div className="min-w-0">
														<p className="truncate font-medium">{org.name}</p>
														<p className="truncate text-xs text-muted-foreground">
															{org.billingEmail} • {org.id}
														</p>
													</div>
													<Badge variant="outline">{org.plan}</Badge>
												</li>
											))}
										</ul>
									</div>

									<div className="space-y-2">
										<Label htmlFor="bulk-block-confirmation">
											Type <strong>{preview.blockable}</strong> to confirm the
											number of organizations to block
										</Label>
										<Input
											id="bulk-block-confirmation"
											inputMode="numeric"
											autoComplete="off"
											value={confirmation}
											onChange={(event) => setConfirmation(event.target.value)}
											placeholder={String(preview.blockable)}
											disabled={blocking}
										/>
									</div>
								</>
							)}
						</div>
					)}

					{result?.success && (
						<div className="space-y-2 text-sm">
							<p>
								Blocked <strong>{result.blockedCount}</strong> organization(s).
							</p>
							{result.failedCount ? (
								<div className="rounded-md border border-destructive/40 p-3">
									<p className="font-medium text-destructive">
										{result.failedCount} failed:
									</p>
									<ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
										{result.failed?.map((failure) => (
											<li key={failure.id}>
												{failure.name}: {failure.error}
											</li>
										))}
									</ul>
								</div>
							) : null}
						</div>
					)}

					{(blockError || previewError) && (
						<div className="space-y-1" role="alert">
							{blockError && (
								<p className="text-sm text-destructive">{blockError}</p>
							)}
							{previewError && (
								<p className="text-sm text-destructive">{previewError}</p>
							)}
						</div>
					)}

					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setOpen(false)}
							disabled={blocking}
						>
							{result?.success ? "Close" : "Cancel"}
						</Button>
						{!result?.success && (
							<Button
								variant="destructive"
								onClick={handleConfirm}
								disabled={blocking || !confirmationMatches}
							>
								{blocking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
								{preview
									? `Block ${preview.blockable} organization(s)`
									: "Block organizations"}
							</Button>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
