"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { CreditsDisplay } from "@/components/credits/credits-display";
import { SidebarLoungePoints } from "@/components/lounge/sidebar-points";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useOrganization } from "@/hooks/useOrganization";
import { useUser } from "@/hooks/useUser";
import { withOrgParam } from "@/lib/utils";

import { OrganizationSwitcher } from "./organization-switcher";
import { SidebarChatSearch, SidebarNewAction } from "./sidebar-actions";
import { SidebarUserMenu } from "./sidebar-user-menu";
import { StudioNav } from "./studio-nav";

import type { Organization } from "@/lib/types";

interface CanvasSidebarProps {
	organizations: Organization[];
	selectedOrganization: Organization | null;
	onSelectOrganization: (organization: Organization | null) => void;
	className?: string;
	onNewCanvas?: () => void;
}

export function CanvasSidebar({
	organizations,
	selectedOrganization,
	onSelectOrganization,
	className,
	onNewCanvas,
}: CanvasSidebarProps) {
	const switcherOrganizations = organizations.filter(
		(org) => org.kind === "default",
	);
	const switcherSelectedOrganization =
		switcherOrganizations.find((org) => org.id === selectedOrganization?.id) ??
		null;
	const { user, isLoading: isUserLoading } = useUser();
	const { organization, isLoading: isOrgLoading } = useOrganization();

	const searchParams = useSearchParams();
	// Preserve the selected organization across playground navigation so users
	// don't have to re-pick their org on every page.
	const orgIdParam = searchParams.get("orgId");
	const withOrg = (path: string) => withOrgParam(path, orgIdParam);

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
							<Wordmark />
							<Badge>Canvas</Badge>
						</Link>
					</div>
					<StudioNav />
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
							<Wordmark />
							<Badge>Canvas</Badge>
						</Link>
						<div className="w-full rounded-md border p-4 text-sm">
							<div className="font-medium mb-2">Sign in required</div>
							<p className="text-muted-foreground mb-3">
								Please sign in to use Canvas.
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
					<StudioNav />
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
						<SidebarMenuButton size="lg" asChild tooltip="Lounge">
							<Link href={withOrg("/")} prefetch={true}>
								<Wordmark size="sm" iconBox />
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarChatSearch disabled />
					<SidebarNewAction label="New Canvas" onAction={onNewCanvas} />
				</SidebarMenu>
				<StudioNav />
			</SidebarHeader>

			<SidebarContent className="px-2 py-4">
				{switcherOrganizations.length > 0 ? (
					<SidebarMenu className="group-data-[collapsible=icon]:hidden">
						<SidebarMenuItem>
							<OrganizationSwitcher
								organizations={switcherOrganizations}
								selectedOrganization={switcherSelectedOrganization}
								onSelectOrganization={onSelectOrganization}
							/>
						</SidebarMenuItem>
					</SidebarMenu>
				) : null}
			</SidebarContent>

			<SidebarFooter>
				<SidebarLoungePoints />
				<div className="group-data-[collapsible=icon]:hidden">
					<CreditsDisplay
						organization={switcherSelectedOrganization ?? organization}
						isLoading={isOrgLoading}
						isChatPlanOrg={!switcherSelectedOrganization}
					/>
				</div>
				<SidebarUserMenu user={user} />
			</SidebarFooter>
		</Sidebar>
	);
}
