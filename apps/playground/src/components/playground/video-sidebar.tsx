"use client";

import { Film, ImageIcon, LogOutIcon, MessageSquare, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";

import { CreditsDisplay } from "@/components/credits/credits-display";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useOrganization } from "@/hooks/useOrganization";
import { useUser } from "@/hooks/useUser";
import { clearLastUsedProjectCookiesAction } from "@/lib/actions/project";
import { useAuth } from "@/lib/auth-client";

import type { Organization } from "@/lib/types";
import type { VideoGalleryItem } from "@/lib/video-gen";

interface VideoSidebarProps {
	galleryItems: VideoGalleryItem[];
	onNewChat: () => void;
	onItemClick: (itemId: string) => void;
	selectedOrganization: Organization | null;
	className?: string;
}

function HistoryThumbnails({ item }: { item: VideoGalleryItem }) {
	const images: { src: string; label: string }[] = [];

	if (item.frameInputs?.start) {
		images.push({ src: item.frameInputs.start.dataUrl, label: "First" });
	}
	if (item.frameInputs?.end) {
		images.push({ src: item.frameInputs.end.dataUrl, label: "Last" });
	}
	if (item.referenceImages) {
		for (const ref of item.referenceImages) {
			images.push({ src: ref.dataUrl, label: "Ref" });
		}
	}

	if (images.length === 0) {
		return null;
	}

	return (
		<div className="flex gap-0.5 shrink-0 mt-0.5">
			{images.map((img, i) => (
				<img
					key={i}
					src={img.src}
					alt={img.label}
					title={img.label}
					className="h-5 w-5 rounded border object-cover"
				/>
			))}
		</div>
	);
}

export function VideoSidebar({
	galleryItems,
	onNewChat,
	onItemClick,
	selectedOrganization,
	className,
}: VideoSidebarProps) {
	const router = useRouter();
	const posthog = usePostHog();
	const { user, isLoading: isUserLoading } = useUser();
	const { signOut } = useAuth();
	const { organization, isLoading: isOrgLoading } = useOrganization();

	const logout = async () => {
		posthog.reset();
		try {
			await clearLastUsedProjectCookiesAction();
		} catch {
			// ignore
		}
		await signOut({
			fetchOptions: {
				onSuccess: () => {
					router.push(
						process.env.NODE_ENV === "development"
							? "http://localhost:3003/login"
							: "https://chat.llmgateway.io/login",
					);
				},
			},
		});
	};

	const isAuthenticated = !!user;

	if (isUserLoading) {
		return (
			<Sidebar className={className}>
				<SidebarHeader>
					<div className="flex flex-col items-center gap-4 mb-4">
						<Link
							href="/"
							className="flex self-start items-center gap-2 my-2"
							prefetch={true}
						>
							<Logo className="h-10 w-10" />
							<h1 className="text-xl font-semibold">LLM Gateway</h1>
							<Badge>Video</Badge>
						</Link>
					</div>
				</SidebarHeader>
			</Sidebar>
		);
	}

	if (!isAuthenticated) {
		return (
			<Sidebar className={className}>
				<SidebarHeader>
					<div className="flex flex-col items-center gap-4 mb-4">
						<Link
							href="/"
							className="flex self-start items-center gap-2 my-2"
							prefetch={true}
						>
							<Logo className="h-10 w-10" />
							<h1 className="text-xl font-semibold">LLM Gateway</h1>
							<Badge>Video</Badge>
						</Link>
						<div className="w-full rounded-md border p-4 text-sm">
							<div className="font-medium mb-2">Sign in required</div>
							<p className="text-muted-foreground mb-3">
								Please sign in to generate videos.
							</p>
							<div className="flex items-center justify-end gap-2">
								<Button size="sm" asChild>
									<Link href="/login">Sign in</Link>
								</Button>
								<Button size="sm" variant="outline" asChild>
									<Link href="/signup">Create account</Link>
								</Button>
							</div>
						</div>
					</div>
				</SidebarHeader>
			</Sidebar>
		);
	}

	return (
		<Sidebar
			collapsible="icon"
			className={(className ?? "") + " max-md:hidden"}
		>
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton size="lg" asChild tooltip="LLM Gateway">
							<Link href="/" prefetch={true}>
								<Logo className="h-8 w-8" />
								<span className="text-lg font-semibold">LLM Gateway</span>
								<Badge>Video</Badge>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton
							onClick={onNewChat}
							tooltip="New Generation"
							className="border border-border"
						>
							<Plus className="h-4 w-4" />
							<span>New Generation</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton asChild tooltip="Chat">
							<Link href="/">
								<MessageSquare className="h-4 w-4" />
								<span>Chat</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton asChild tooltip="Image Studio">
							<Link href="/image">
								<ImageIcon className="h-4 w-4" />
								<span>Image Studio</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>

			<SidebarContent className="px-2 py-4">
				<SidebarMenu>
					{galleryItems.length > 0 && (
						<div>
							<div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
								History
							</div>
							{galleryItems.map((item) => (
								<SidebarMenuItem key={item.id}>
									<SidebarMenuButton
										onClick={() => onItemClick(item.id)}
										className="text-left py-3 h-auto"
									>
										<div className="flex items-start gap-2 min-w-0 w-full">
											<HistoryThumbnails item={item} />
											<div className="flex-1 min-w-0">
												<div className="truncate text-sm">{item.prompt}</div>
												<div className="text-xs text-muted-foreground">
													{new Date(item.timestamp).toLocaleTimeString([], {
														hour: "numeric",
														minute: "2-digit",
													})}
												</div>
											</div>
										</div>
									</SidebarMenuButton>
								</SidebarMenuItem>
							))}
						</div>
					)}

					{galleryItems.length === 0 && (
						<div className="flex flex-col items-center justify-center py-8 text-center">
							<Film className="h-12 w-12 text-muted-foreground/50 mb-4" />
							<p className="text-sm text-muted-foreground mb-2">
								No generation history
							</p>
							<p className="text-xs text-muted-foreground">
								Generate a video to see it here
							</p>
						</div>
					)}
				</SidebarMenu>
			</SidebarContent>

			<SidebarFooter className="border-t">
				<div className="group-data-[collapsible=icon]:hidden">
					<CreditsDisplay
						organization={organization}
						isLoading={isOrgLoading}
					/>
				</div>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton asChild tooltip={user?.name ?? "User"}>
							<div className="flex items-center gap-3">
								<Avatar className="border-border h-8 w-8 border">
									<AvatarFallback className="bg-muted text-xs">
										{user?.name?.slice(0, 2) ?? "AU"}
									</AvatarFallback>
								</Avatar>
								<div className="grid flex-1 text-left text-sm leading-tight">
									<span className="truncate font-medium">{user?.name}</span>
									<span className="truncate text-xs text-muted-foreground">
										{user?.email}
									</span>
								</div>
							</div>
						</SidebarMenuButton>
						<SidebarMenuAction
							onClick={logout}
							className="group-data-[collapsible=icon]:hidden"
						>
							<LogOutIcon className="h-4 w-4" />
						</SidebarMenuAction>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>
		</Sidebar>
	);
}
