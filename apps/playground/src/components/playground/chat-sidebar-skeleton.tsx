"use client";
import { Loader2 } from "lucide-react";
import Link from "next/link";

import { CreditsDisplay } from "@/components/credits/credits-display";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Wordmark } from "@/components/ui/wordmark";

import { StudioNav } from "./studio-nav";

import type { Organization } from "@/lib/types";

interface ChatSidebarSkeletonProps {
	className?: string;
	onNewChat?: () => void;
	organization: Organization | null;
	isOrgLoading: boolean;
}

export const ChatSidebarSkeleton = ({
	className,
	onNewChat,
	organization,
	isOrgLoading,
}: ChatSidebarSkeletonProps) => {
	return (
		<Sidebar collapsible="icon" className={className}>
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton size="lg" asChild tooltip="Lounge">
							<Link href="/" prefetch={true}>
								<Wordmark size="sm" iconBox />
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton
							onClick={onNewChat}
							disabled
							tooltip="New Chat"
							className="border border-border"
						>
							<Loader2 className="h-4 w-4 animate-spin" />
							<span>New Chat</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
				<StudioNav />
			</SidebarHeader>

			<SidebarContent className="px-2 py-4">
				<div className="flex items-center justify-center py-8 group-data-[collapsible=icon]:hidden">
					<div className="text-sm text-muted-foreground">Loading chats...</div>
				</div>
			</SidebarContent>
			<SidebarFooter className="border-t">
				<div className="group-data-[collapsible=icon]:hidden">
					<CreditsDisplay
						organization={organization}
						isLoading={isOrgLoading}
					/>
				</div>
			</SidebarFooter>
		</Sidebar>
	);
};
