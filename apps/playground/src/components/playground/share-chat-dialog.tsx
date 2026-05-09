"use client";

import { Check, Copy, Info, Loader2, Share, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDeleteChatShare, useShareChat } from "@/hooks/useChats";

interface ShareChatDialogProps {
	currentChatId: string;
	shareId: string | null;
}

export function ShareChatDialog({
	currentChatId,
	shareId,
}: ShareChatDialogProps) {
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState(false);
	const [createdShareUrl, setCreatedShareUrl] = useState<string | null>(null);
	const shareChat = useShareChat();
	const deleteShare = useDeleteChatShare();
	const shareUrl = useMemo(() => {
		if (!shareId || typeof window === "undefined") {
			return "";
		}

		return `${window.location.origin}/share/${shareId}`;
	}, [shareId]);
	const activeShareUrl = createdShareUrl ?? shareUrl;

	useEffect(() => {
		if (shareUrl) {
			setCreatedShareUrl(null);
		}
	}, [shareUrl]);

	useEffect(() => {
		if (open) {
			setCopied(false);
		}
	}, [open]);

	const copyLink = async (url: string) => {
		try {
			await navigator.clipboard.writeText(url);
			setCopied(true);
			toast.success("Share link copied");
		} catch {
			toast.error("Failed to copy share link");
		}
	};

	const createShare = async () => {
		const data = await shareChat.mutateAsync({
			params: { path: { id: currentChatId } },
		});
		const url = `${window.location.origin}${data.share.url}`;
		setCreatedShareUrl(url);
		await copyLink(url);
	};

	const deleteSharedLink = async () => {
		await deleteShare.mutateAsync({
			params: { path: { id: currentChatId } },
		});
		setCreatedShareUrl(null);
		setOpen(false);
	};

	const isShared = Boolean(shareId || createdShareUrl);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<Tooltip>
				<TooltipTrigger asChild>
					<DialogTrigger asChild>
						<Button
							type="button"
							variant={isShared ? "secondary" : "ghost"}
							size="icon-sm"
							className="relative"
							aria-label="Share chat"
						>
							<Share className="size-4" />
							{isShared ? (
								<span className="bg-primary absolute right-1 top-1 size-1.5 rounded-full" />
							) : null}
						</Button>
					</DialogTrigger>
				</TooltipTrigger>
				<TooltipContent>
					<p>{isShared ? "Public link active" : "Share chat"}</p>
				</TooltipContent>
			</Tooltip>
			<DialogContent className="gap-5 overflow-hidden p-0 sm:max-w-[560px]">
				<DialogHeader>
					<DialogTitle className="px-6 pt-6 text-2xl">
						{isShared ? "Shareable public link" : "Share chat"}
					</DialogTitle>
				</DialogHeader>
				<div className="space-y-5 px-6">
					{isShared && activeShareUrl ? (
						<div className="bg-muted flex items-center gap-2 rounded-full px-4 py-2">
							<a
								href={activeShareUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="min-w-0 flex-1 truncate text-sm underline underline-offset-2"
							>
								{activeShareUrl}
							</a>
							<Button
								type="button"
								size="sm"
								className="rounded-full"
								onClick={() => copyLink(activeShareUrl)}
							>
								{copied ? (
									<Check className="size-4" />
								) : (
									<Copy className="size-4" />
								)}
								{copied ? "Link copied" : "Copy link"}
							</Button>
						</div>
					) : (
						<p className="text-muted-foreground text-sm">
							Only messages up to this point will be shared.
						</p>
					)}
					<div className="text-muted-foreground flex gap-2 text-xs leading-relaxed">
						<Info className="mt-0.5 size-3.5 shrink-0" />
						<p>
							Anyone with this link can open the snapshot. Avoid sharing private
							details, and remove the link when it should no longer be
							available.
						</p>
					</div>
				</div>
				<DialogFooter
					className={`items-center px-6 pb-6 ${
						isShared ? "sm:justify-start" : "sm:justify-end"
					}`}
				>
					{isShared ? (
						<Button
							type="button"
							variant="ghost"
							className="text-destructive hover:text-destructive"
							disabled={deleteShare.isPending}
							onClick={deleteSharedLink}
						>
							{deleteShare.isPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Trash2 className="size-4" />
							)}
							{deleteShare.isPending ? "Deleting..." : "Delete shared link"}
						</Button>
					) : (
						<span />
					)}
					{isShared ? null : (
						<Button
							type="button"
							disabled={shareChat.isPending}
							onClick={createShare}
						>
							{shareChat.isPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : null}
							{shareChat.isPending ? "Creating..." : "Create share link"}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
