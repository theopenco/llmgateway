"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	Building2,
	Check,
	Copy,
	Globe2,
	Info,
	Linkedin,
	Loader2,
	Plus,
	Share,
	Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	useDeleteChatShare,
	useDeleteOrgChatShare,
	useShareChat,
} from "@/hooks/useChats";
import { useApi } from "@/lib/fetch-client";

import type { Organization } from "@/lib/types";

interface ShareChatDialogProps {
	currentChatId: string;
	disabled?: boolean;
	shareId: string | null;
	orgShares: Array<{ id: string; organizationId: string }>;
	organizations: Organization[];
	chatTitle?: string | null;
	previewPrompt?: string | null;
}

type ShareMode = "public" | "organization";

function XIcon(props: React.SVGProps<SVGSVGElement>) {
	return (
		<svg
			viewBox="0 0 16 16"
			fill="currentColor"
			strokeLinejoin="round"
			{...props}
		>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M1.60022 2H5.80022L8.78759 6.16842L12.4002 2H14.0002L9.5118 7.17895L14.4002 14H10.2002L7.21285 9.83158L3.60022 14H2.00022L6.48864 8.82105L1.60022 2ZM10.8166 12.8L3.93657 3.2H5.18387L12.0639 12.8H10.8166Z"
			/>
		</svg>
	);
}

function RedditIcon(props: React.SVGProps<SVGSVGElement>) {
	return (
		<svg viewBox="0 0 24 24" fill="currentColor" {...props}>
			<path d="M14.238 15.348c.085.084.085.221 0 .306-.465.462-1.194.687-2.231.687l-.008-.002-.008.002c-1.036 0-1.766-.225-2.231-.688-.085-.084-.085-.221 0-.305.084-.084.222-.084.307 0 .379.377 1.008.561 1.924.561l.008.002.008-.002c.915 0 1.544-.184 1.924-.561.085-.084.223-.084.307 0zm-3.44-2.418c0-.507-.414-.918-.922-.918-.509 0-.923.411-.923.918 0 .506.414.918.923.918.508 0 .922-.412.922-.918zm4.434-.918c-.508 0-.922.411-.922.918 0 .506.414.918.922.918s.922-.412.922-.918c0-.507-.414-.918-.922-.918zM24 11.5c0 6.351-5.373 11.5-12 11.5S0 17.851 0 11.5 5.373 0 12 0s12 5.149 12 11.5zm-4.911-.793a1.643 1.643 0 0 0-1.643-1.64 1.62 1.62 0 0 0-1.092.42c-1.082-.711-2.495-1.158-4.038-1.213l.804-2.534 2.243.526a1.36 1.36 0 0 0 1.357 1.298c.752 0 1.364-.611 1.364-1.363a1.366 1.366 0 0 0-2.644-.464l-2.479-.581a.213.213 0 0 0-.253.144l-.95 2.994c-1.598.034-3.061.481-4.182 1.203a1.62 1.62 0 0 0-1.099-.43A1.643 1.643 0 0 0 4.91 10.707a1.65 1.65 0 0 0 .846 1.44c-.026.18-.038.363-.038.55 0 2.704 3.273 4.901 7.297 4.901 4.024 0 7.297-2.197 7.297-4.901 0-.184-.013-.367-.038-.546a1.65 1.65 0 0 0 .815-1.444z" />
		</svg>
	);
}

interface ShareSocialButtonProps {
	href: string;
	label: string;
	children: React.ReactNode;
}

function ShareSocialButton({ href, label, children }: ShareSocialButtonProps) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className="group flex w-full flex-col items-center gap-1.5 sm:gap-2"
		>
			<span className="bg-foreground text-background flex size-11 items-center justify-center rounded-full transition-transform group-hover:scale-105 sm:size-14">
				{children}
			</span>
			<span className="text-foreground text-xs font-medium sm:text-sm">
				{label}
			</span>
		</a>
	);
}

function clipPreview(
	text: string | null | undefined,
	max: number,
): string | null {
	if (!text) {
		return null;
	}
	const flat = text.replace(/\s+/g, " ").trim();
	if (!flat) {
		return null;
	}
	return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

interface ShareVisibilityIndicatorProps {
	shared: boolean;
}

function ShareVisibilityIndicator({ shared }: ShareVisibilityIndicatorProps) {
	return shared ? (
		<span className="flex shrink-0 items-center gap-2">
			<Check className="size-4 text-emerald-500" />
			<span className="sr-only">Already shared</span>
		</span>
	) : null;
}

export function ShareChatDialog({
	currentChatId,
	disabled = true,
	shareId,
	orgShares,
	organizations,
	chatTitle,
	previewPrompt,
}: ShareChatDialogProps) {
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState(false);
	const [createdShareUrl, setCreatedShareUrl] = useState<string | null>(null);
	// orgId → shareId for all known org shares (from props + created in session)
	const [orgShareMap, setOrgShareMap] = useState<Record<string, string>>(() =>
		Object.fromEntries(orgShares.map((s) => [s.organizationId, s.id])),
	);
	const [shareMode, setShareMode] = useState<ShareMode>("public");
	const [selectedOrgId, setSelectedOrgId] = useState<string>("");
	const [deletingOrgId, setDeletingOrgId] = useState<string | null>(null);
	const wasOpenRef = useRef(false);
	const queryClient = useQueryClient();
	const api = useApi();
	const shareChat = useShareChat();
	const deleteShare = useDeleteChatShare();
	const deleteOrgShare = useDeleteOrgChatShare(currentChatId);
	const shareUrl = useMemo(() => {
		if (!shareId || typeof window === "undefined") {
			return "";
		}

		return `${window.location.origin}/share/${shareId}`;
	}, [shareId]);
	const activeShareUrl = createdShareUrl ?? shareUrl;

	const previewTitle = useMemo(() => {
		const trimmed = chatTitle?.trim();
		if (trimmed) {
			return trimmed;
		}
		return clipPreview(previewPrompt, 80) ?? "Shared chat";
	}, [chatTitle, previewPrompt]);

	const previewText = useMemo(
		() => clipPreview(previewPrompt, 160),
		[previewPrompt],
	);

	const shareTitle = previewTitle;
	const encodedShareUrl = activeShareUrl
		? encodeURIComponent(activeShareUrl)
		: "";
	const encodedShareTitle = encodeURIComponent(shareTitle);

	const xUrl = activeShareUrl
		? `https://x.com/intent/tweet?url=${encodedShareUrl}&text=${encodedShareTitle}`
		: "";
	const linkedinUrl = activeShareUrl
		? `https://www.linkedin.com/sharing/share-offsite/?url=${encodedShareUrl}`
		: "";
	const redditUrl = activeShareUrl
		? `https://www.reddit.com/submit?url=${encodedShareUrl}&title=${encodedShareTitle}`
		: "";

	useEffect(() => {
		if (shareUrl) {
			setCreatedShareUrl(null);
		}
	}, [shareUrl]);

	useEffect(() => {
		setOrgShareMap(
			Object.fromEntries(orgShares.map((s) => [s.organizationId, s.id])),
		);
		setCreatedShareUrl(null);
	}, [currentChatId]); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		setOrgShareMap(
			Object.fromEntries(orgShares.map((s) => [s.organizationId, s.id])),
		);
	}, [orgShares]);

	useEffect(() => {
		if (open && !wasOpenRef.current) {
			setCopied(false);
			setShareMode("public");
			setSelectedOrgId("");
		}
		wasOpenRef.current = open;
	}, [open]);

	useEffect(() => {
		if (organizations.length === 0 && shareMode === "organization") {
			setShareMode("public");
		}
	}, [organizations.length, shareMode]);

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
			body: {},
		});
		const url = `${window.location.origin}${data.share.url}`;
		setCreatedShareUrl(url);
		await copyLink(url);
	};

	const createOrgShare = async () => {
		if (!selectedOrgId) {
			toast.error("Select an organization");
			return;
		}

		const data = await shareChat.mutateAsync({
			params: { path: { id: currentChatId } },
			body: { organizationId: selectedOrgId },
		});
		setOrgShareMap((prev) => ({ ...prev, [selectedOrgId]: data.share.id }));
		setSelectedOrgId("");
		toast.success("Shared with organization");
	};

	const deleteSharedLink = async () => {
		await deleteShare.mutateAsync({
			params: { path: { id: currentChatId } },
		});
		setCreatedShareUrl(null);
	};

	const deleteOrganizationShare = async (orgId: string, shareId: string) => {
		setDeletingOrgId(orgId);
		try {
			await deleteOrgShare.mutateAsync({
				params: { path: { shareId } },
			});
			const orgSharesQueryKey = api.queryOptions(
				"get",
				"/chats/org/{organizationId}/shares",
				{ params: { path: { organizationId: orgId } } },
			).queryKey;
			void queryClient.invalidateQueries({ queryKey: orgSharesQueryKey });
			setOrgShareMap((prev) =>
				Object.fromEntries(
					Object.entries(prev).filter(([key]) => key !== orgId),
				),
			);
		} finally {
			setDeletingOrgId(null);
		}
	};

	const isPublicShared = Boolean(shareId || createdShareUrl);
	const isOrganizationShared = Object.keys(orgShareMap).length > 0;
	const isAnyShared = Boolean(
		shareId || createdShareUrl || isOrganizationShared,
	);
	const isCreatingSelectedMode = shareChat.isPending;
	const sharedOrgEntries = Object.entries(orgShareMap).map(([orgId, sId]) => ({
		orgId,
		shareId: sId,
		name: organizations.find((o) => o.id === orgId)?.name ?? orgId,
	}));

	const tooltipText = disabled
		? "Share is available after the response finishes"
		: isAnyShared
			? "Share active"
			: "Share chat";

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (disabled && nextOpen) {
					return;
				}
				setOpen(nextOpen);
			}}
		>
			<Tooltip>
				<TooltipTrigger asChild>
					<span className="inline-flex" tabIndex={disabled ? 0 : undefined}>
						<DialogTrigger asChild>
							<Button
								type="button"
								variant={isAnyShared ? "secondary" : "ghost"}
								size="icon-sm"
								className="relative"
								disabled={disabled}
								aria-label="Share chat"
							>
								<Share className="size-4" />
								{isAnyShared ? (
									<span className="bg-primary absolute right-1 top-1 size-1.5 rounded-full" />
								) : null}
							</Button>
						</DialogTrigger>
					</span>
				</TooltipTrigger>
				<TooltipContent>
					<p>{tooltipText}</p>
				</TooltipContent>
			</Tooltip>
			<DialogContent className="w-[calc(100vw-2rem)] max-w-[520px] min-w-0 gap-0 overflow-hidden p-0">
				<DialogHeader className="px-5 pt-5 text-left sm:px-6 sm:pt-6">
					<DialogTitle className="pb-2 pr-8 text-left text-lg font-semibold sm:text-xl">
						{previewTitle}
					</DialogTitle>
				</DialogHeader>
				<div className="px-5 py-4 sm:px-6">
					<div className="border-border overflow-hidden rounded-lg border">
						<button
							type="button"
							className={[
								"flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
								shareMode === "public" ? "bg-muted/60" : "hover:bg-muted/40",
							].join(" ")}
							onClick={() => setShareMode("public")}
						>
							<Globe2 className="text-muted-foreground size-4 shrink-0" />
							<span className="min-w-0 flex-1">
								<span className="block text-sm font-medium">Public</span>
								<span className="text-muted-foreground block text-sm">
									Anyone with the link can view
								</span>
							</span>
							<ShareVisibilityIndicator shared={isPublicShared} />
						</button>
						<button
							type="button"
							disabled={organizations.length === 0}
							className={[
								"flex w-full items-center gap-3 border-t px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
								shareMode === "organization"
									? "bg-muted/60"
									: "hover:bg-muted/40",
							].join(" ")}
							onClick={() => {
								if (organizations.length > 0) {
									setShareMode("organization");
								}
							}}
						>
							<Building2 className="text-muted-foreground size-4 shrink-0" />
							<span className="min-w-0 flex-1">
								<span className="block text-sm font-medium">Organization</span>
								<span className="text-muted-foreground block text-sm">
									Members of an organization can view
								</span>
							</span>
							<ShareVisibilityIndicator shared={isOrganizationShared} />
						</button>
					</div>
				</div>
				{shareMode === "public" && isPublicShared && activeShareUrl ? (
					<div className="space-y-5 px-5 pb-5 sm:px-6 sm:pb-6">
						<div className="bg-muted/60 border-border/60 relative overflow-hidden rounded-2xl border p-4 sm:p-5">
							{previewText ? (
								<p className="text-foreground/90 line-clamp-4 text-sm leading-relaxed sm:text-[15px]">
									{previewText}
								</p>
							) : (
								<p className="text-muted-foreground text-sm">
									A snapshot of this chat will be visible to anyone with the
									link.
								</p>
							)}
						</div>
						<div className="bg-muted/40 border-border/60 flex min-w-0 items-center gap-2 rounded-full border px-3 py-2">
							<a
								href={activeShareUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="text-foreground min-w-0 flex-1 truncate text-sm"
								title={activeShareUrl}
							>
								{activeShareUrl}
							</a>
							<Button
								type="button"
								size="sm"
								variant="ghost"
								className="h-8 shrink-0 rounded-full px-3"
								onClick={() => copyLink(activeShareUrl)}
								aria-label={copied ? "Link copied" : "Copy link"}
							>
								{copied ? (
									<Check className="size-4" />
								) : (
									<Copy className="size-4" />
								)}
							</Button>
						</div>
						<div className="grid min-w-0 grid-cols-4 gap-2 sm:gap-3">
							<button
								type="button"
								onClick={() => copyLink(activeShareUrl)}
								className="group flex w-full flex-col items-center gap-1.5 sm:gap-2"
							>
								<span className="bg-foreground text-background flex size-11 items-center justify-center rounded-full transition-transform group-hover:scale-105 sm:size-14">
									{copied ? (
										<Check className="size-5" />
									) : (
										<Copy className="size-5" />
									)}
								</span>
								<span className="text-foreground text-xs font-medium sm:text-sm">
									{copied ? "Copied" : "Copy link"}
								</span>
							</button>
							<ShareSocialButton href={xUrl} label="X">
								<XIcon className="size-5" />
							</ShareSocialButton>
							<ShareSocialButton href={linkedinUrl} label="LinkedIn">
								<Linkedin className="size-5" />
							</ShareSocialButton>
							<ShareSocialButton href={redditUrl} label="Reddit">
								<RedditIcon className="size-5" />
							</ShareSocialButton>
						</div>
						<div className="text-muted-foreground flex gap-2 text-xs leading-relaxed">
							<Info className="mt-0.5 size-3.5 shrink-0" />
							<p className="min-w-0">
								Anyone with this link can open the snapshot. Avoid sharing
								private details, and remove the link when it should no longer be
								available.
							</p>
						</div>
						<div className="flex justify-center">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="text-destructive hover:text-destructive h-8"
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
						</div>
					</div>
				) : shareMode === "organization" ? (
					<div className="space-y-3 px-5 pb-5 sm:px-6 sm:pb-6">
						<div className="flex gap-2">
							<Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
								<SelectTrigger className="min-w-0 flex-1">
									<SelectValue placeholder="Select organization" />
								</SelectTrigger>
								<SelectContent>
									{organizations.map((org) => (
										<SelectItem
											key={org.id}
											value={org.id}
											disabled={Boolean(orgShareMap[org.id])}
										>
											{org.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Button
								type="button"
								size="icon"
								disabled={
									!selectedOrgId ||
									Boolean(orgShareMap[selectedOrgId]) ||
									isCreatingSelectedMode
								}
								onClick={createOrgShare}
								aria-label="Add organization"
								className="sm:w-auto sm:px-4"
							>
								{isCreatingSelectedMode ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<>
										<Plus className="size-4 sm:hidden" />
										<span className="hidden sm:inline">Add</span>
									</>
								)}
							</Button>
						</div>
						{sharedOrgEntries.length > 0 ? (
							<div className="border-border overflow-hidden rounded-lg border">
								{sharedOrgEntries.map(({ orgId, shareId: sId, name }) => (
									<div
										key={orgId}
										className="flex items-center gap-3 px-3 py-2 text-sm [&:not(:first-child)]:border-t"
									>
										<span className="min-w-0 flex-1 truncate">{name}</span>
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											className="text-destructive hover:text-destructive shrink-0"
											disabled={deletingOrgId !== null}
											onClick={() => deleteOrganizationShare(orgId, sId)}
											aria-label={`Remove ${name}`}
										>
											{deletingOrgId === orgId ? (
												<Loader2 className="size-3.5 animate-spin" />
											) : (
												<Trash2 className="size-3.5" />
											)}
										</Button>
									</div>
								))}
							</div>
						) : null}
						<div className="text-muted-foreground flex gap-2 text-xs leading-relaxed">
							<Info className="mt-0.5 size-3.5 shrink-0" />
							<p>
								Only messages up to this point will be shared. Members of the
								selected organization can view the snapshot and fork it to
								continue privately.
							</p>
						</div>
					</div>
				) : (
					<div className="min-w-0 space-y-4 px-5 pb-5 sm:px-6 sm:pb-6">
						<p className="text-muted-foreground text-sm">
							Only messages up to this point will be shared. Anyone with the
							link will be able to see the snapshot.
						</p>
						<div className="text-muted-foreground flex gap-2 text-xs leading-relaxed">
							<Info className="mt-0.5 size-3.5 shrink-0" />
							<p className="min-w-0">
								Avoid sharing private details — once the link is created you can
								copy it and share it on X, LinkedIn, or Reddit.
							</p>
						</div>
						<div className="flex justify-end">
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
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
