"use client";

import {
	ChevronDown,
	Plus,
	ScrollTextIcon,
	Sparkles,
	UploadIcon,
	FileTextIcon,
} from "lucide-react";
import Link from "next/link";

import { CreditsDisplay } from "@/components/credits/credits-display";
import { SidebarLoungePoints } from "@/components/lounge/sidebar-points";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@/components/ui/sidebar";
import { Wordmark } from "@/components/ui/wordmark";
import { useUser } from "@/hooks/useUser";
import { cn } from "@/lib/utils";

import { ChatSidebarSkeleton } from "./chat-sidebar-skeleton";
import {
	SidebarChatSearch,
	SidebarShortcutKbd,
	useSidebarShortcut,
} from "./sidebar-actions";
import { SidebarUserMenu } from "./sidebar-user-menu";
import { StudioNav } from "./studio-nav";

import type { Skill } from "@/hooks/useSkills";
import type { Organization } from "@/lib/types";

interface SkillsSidebarProps {
	skills: Skill[];
	selectedSkillId: string | null;
	onSelectSkill: (skillId: string) => void;
	isLoading?: boolean;
	onCreateOpen: () => void;
	onGenerateOpen: () => void;
	onUploadOpen: () => void;
	selectedOrganization: Organization | null;
	className?: string;
}

export function SkillsSidebar({
	skills,
	selectedSkillId,
	onSelectSkill,
	isLoading,
	onCreateOpen,
	onGenerateOpen,
	onUploadOpen,
	selectedOrganization,
	className,
}: SkillsSidebarProps) {
	const { state: sidebarState, isMobile } = useSidebar();
	const { user, isLoading: isUserLoading } = useUser();

	const isMac = useSidebarShortcut("j", onCreateOpen);

	const isHistoryHidden = sidebarState === "collapsed" && !isMobile;

	if (isUserLoading) {
		return <ChatSidebarSkeleton organization={null} isOrgLoading={false} />;
	}

	if (!user) {
		return (
			<Sidebar className={className}>
				<SidebarHeader>
					<div className="flex flex-col items-center gap-4 mb-4">
						<Link
							href="/"
							className="flex self-start items-center gap-2 my-2"
							prefetch={true}
						>
							<Wordmark />
						</Link>
						<div className="w-full rounded-md border p-4 text-sm">
							<div className="font-medium mb-2">Sign in required</div>
							<p className="text-muted-foreground mb-3">
								Please sign in to view your skills.
							</p>
							<div className="flex items-center justify-end gap-2">
								<Button size="sm" asChild>
									<Link href="/login">Sign in</Link>
								</Button>
							</div>
						</div>
					</div>
					<StudioNav />
				</SidebarHeader>
			</Sidebar>
		);
	}

	return (
		<Sidebar collapsible="icon" className={cn(className, "max-md:hidden")}>
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton size="lg" asChild tooltip="Lounge">
							<Link href="/" prefetch={true}>
								<Wordmark size="sm" iconBox />
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarChatSearch disabled />
					<SidebarMenuItem>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<SidebarMenuButton
									tooltip="New Skill"
									className="border border-border"
								>
									<Plus className="h-4 w-4" />
									<span>New Skill</span>
									<SidebarShortcutKbd keys={isMac ? "⌘J" : "Alt+J"} />
									<ChevronDown className="ml-auto h-3 w-3 text-muted-foreground" />
								</SidebarMenuButton>
							</DropdownMenuTrigger>
							<DropdownMenuContent side="right" align="start" className="w-48">
								<DropdownMenuItem onClick={onCreateOpen}>
									<FileTextIcon className="mr-2 h-4 w-4" />
									Write skill
								</DropdownMenuItem>
								<DropdownMenuItem onClick={onGenerateOpen}>
									<Sparkles className="mr-2 h-4 w-4" />
									Generate with AI
								</DropdownMenuItem>
								<DropdownMenuItem onClick={onUploadOpen}>
									<UploadIcon className="mr-2 h-4 w-4" />
									Upload a skill
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</SidebarMenuItem>
				</SidebarMenu>
				<StudioNav />
			</SidebarHeader>

			<SidebarContent className="overflow-hidden pb-2">
				<div>
					<div className="mx-2 mb-2 border-t border-sidebar-border" />
				</div>
				<div
					aria-hidden={isHistoryHidden}
					className="flex min-h-0 flex-1 flex-col transition-opacity duration-200 ease-linear group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:opacity-0"
				>
					<div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
						My Skills
					</div>
					{isLoading ? (
						<div className="flex items-center justify-center py-8">
							<span className="text-muted-foreground text-sm">
								Loading skills...
							</span>
						</div>
					) : skills.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-8 px-4 text-center">
							<ScrollTextIcon className="h-8 w-8 text-muted-foreground/50 mb-3" />
							<p className="text-sm text-muted-foreground">No skills yet</p>
						</div>
					) : (
						<SidebarMenu className="px-2">
							{skills.map((skill) => (
								<SidebarMenuItem key={skill.id}>
									<SidebarMenuButton
										isActive={selectedSkillId === skill.id}
										onClick={() => onSelectSkill(skill.id)}
										tooltip={skill.name}
										className="h-auto py-2"
									>
										<div className="flex-1 min-w-0">
											<div className="truncate text-sm font-medium">
												{skill.name}
											</div>
											{skill.description && (
												<div className="truncate text-xs text-muted-foreground">
													{skill.description}
												</div>
											)}
										</div>
									</SidebarMenuButton>
								</SidebarMenuItem>
							))}
						</SidebarMenu>
					)}
				</div>
			</SidebarContent>

			<SidebarFooter>
				<SidebarLoungePoints />
				<div className="group-data-[collapsible=icon]:hidden">
					<CreditsDisplay
						organization={selectedOrganization}
						isLoading={false}
					/>
				</div>
				<SidebarUserMenu user={user} />
			</SidebarFooter>
		</Sidebar>
	);
}
