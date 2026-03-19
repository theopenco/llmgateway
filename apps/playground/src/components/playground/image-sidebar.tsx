"use client";

import { ImageIcon, LogOutIcon, MessageSquare } from "lucide-react";
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
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useOrganization } from "@/hooks/useOrganization";
import { useUser } from "@/hooks/useUser";
import { clearLastUsedProjectCookiesAction } from "@/lib/actions/project";
import { useAuth } from "@/lib/auth-client";

import type { Organization } from "@/lib/types";

interface ImageSidebarProps {
	recentPrompts: string[];
	onPromptClick: (prompt: string) => void;
	selectedOrganization: Organization | null;
	className?: string;
}

export function ImageSidebar({
	recentPrompts,
	onPromptClick,
	selectedOrganization,
	className,
}: ImageSidebarProps) {
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
							<Badge>Image</Badge>
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
							<Badge>Image</Badge>
						</Link>
						<div className="w-full rounded-md border p-4 text-sm">
							<div className="font-medium mb-2">Sign in required</div>
							<p className="text-muted-foreground mb-3">
								Please sign in to generate images.
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
		<Sidebar className={(className ?? "") + " max-md:hidden"}>
			<SidebarHeader>
				<div className="flex flex-col items-center gap-4 mb-4">
					<Link
						href="/"
						className="flex self-start items-center gap-2 my-2"
						prefetch={true}
					>
						<Logo className="h-10 w-10" />
						<h1 className="text-xl font-semibold">LLM Gateway</h1>
						<Badge>Image</Badge>
					</Link>
				</div>
			</SidebarHeader>

			<SidebarContent className="px-2 py-4">
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton asChild>
							<Link href="/">
								<MessageSquare className="h-4 w-4" />
								Chat
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton isActive>
							<ImageIcon className="h-4 w-4" />
							Image Studio
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>

				{recentPrompts.length > 0 && (
					<div className="mt-6">
						<div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
							Recent prompts
						</div>
						<SidebarMenu>
							{recentPrompts.map((prompt, i) => (
								<SidebarMenuItem key={i}>
									<SidebarMenuButton
										onClick={() => onPromptClick(prompt)}
										className="text-left"
									>
										<span className="truncate text-sm">{prompt}</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							))}
						</SidebarMenu>
					</div>
				)}
			</SidebarContent>

			<SidebarFooter className="border-t">
				<CreditsDisplay organization={organization} isLoading={isOrgLoading} />
				<div className="flex items-center justify-between p-4 pt-0">
					<div className="flex items-center gap-3 flex-1">
						<Avatar className="border-border h-9 w-9 border">
							<AvatarFallback className="bg-muted">
								{user?.name?.slice(0, 2) ?? "AU"}
							</AvatarFallback>
						</Avatar>
						<div className="text-sm flex-1 min-w-0">
							<div className="flex items-center gap-2 font-medium truncate">
								{user?.name}
							</div>
							<div className="text-xs text-muted-foreground truncate">
								{user?.email}
							</div>
						</div>
					</div>
					<Button
						variant="ghost"
						size="sm"
						onClick={logout}
						className="p-2 h-auto ml-2"
						title="Sign out"
					>
						<LogOutIcon className="h-4 w-4" />
					</Button>
				</div>
				<a
					href="https://status.llmgateway.io/"
					target="_blank"
					rel="noopener noreferrer"
					className="flex items-center justify-center gap-2 px-4 pb-4 text-xs text-muted-foreground hover:text-foreground transition-colors"
				>
					<span className="relative flex h-2 w-2">
						<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
						<span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
					</span>
					All systems operational
				</a>
			</SidebarFooter>
		</Sidebar>
	);
}
