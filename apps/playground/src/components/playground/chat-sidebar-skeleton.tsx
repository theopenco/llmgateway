"use client";
import { Loader2 } from "lucide-react";
import Link from "next/link";

import { CreditsDisplay } from "@/components/credits/credits-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
} from "@/components/ui/sidebar";

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
						<Badge>Chat</Badge>
					</Link>
					<Button
						variant="outline"
						className="w-full flex items-center gap-2"
						onClick={onNewChat}
						disabled
					>
						<Loader2 className="h-4 w-4 animate-spin" />
						New Chat
					</Button>
				</div>
			</SidebarHeader>

			<SidebarContent className="px-2 py-4">
				<div className="flex items-center justify-center py-8">
					<div className="text-sm text-muted-foreground">Loading chats...</div>
				</div>
			</SidebarContent>
			<SidebarFooter className="border-t">
				<CreditsDisplay organization={organization} isLoading={isOrgLoading} />
			</SidebarFooter>
		</Sidebar>
	);
};
