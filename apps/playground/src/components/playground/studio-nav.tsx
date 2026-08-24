"use client";

import {
	AudioLines,
	DoorOpen,
	Film,
	Folder,
	ImagePlus,
	MessageSquare,
	PenTool,
	Phone,
	ScrollText,
	Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { useSidebar } from "@/components/ui/sidebar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, withOrgParam } from "@/lib/utils";

export const STUDIO_NAV_ITEMS = [
	{ href: "/", label: "Chat", tooltip: "Chat", icon: MessageSquare },
	{ href: "/group", label: "Group", tooltip: "Group Chat", icon: Users },
	{ href: "/image", label: "Image", tooltip: "Image Studio", icon: ImagePlus },
	{ href: "/video", label: "Video", tooltip: "Video Studio", icon: Film },
	{ href: "/audio", label: "Audio", tooltip: "Audio Studio", icon: AudioLines },
	{ href: "/realtime", label: "Voice", tooltip: "Voice Calls", icon: Phone },
	{ href: "/canvas", label: "Canvas", tooltip: "Canvas", icon: PenTool },
	{ href: "/projects", label: "Projects", tooltip: "Projects", icon: Folder },
	{ href: "/skills", label: "Skills", tooltip: "Skills", icon: ScrollText },
	{
		href: "/escape",
		label: "Escape",
		tooltip: "Sandbox Escape",
		icon: DoorOpen,
	},
] as const;

// Compact studio switcher shared by every playground sidebar. Renders the
// destinations as a tile grid instead of one full-width row each, keeps the
// current route highlighted (including /projects and /skills, whose sidebars
// previously dropped their own nav entry), and preserves the ?orgId context.
export function StudioNav() {
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const orgIdParam = searchParams.get("orgId");
	const { state, isMobile, setOpenMobile } = useSidebar();

	const withOrg = (path: string) => withOrgParam(path, orgIdParam);

	return (
		<nav
			aria-label="Studios"
			className="grid grid-cols-4 gap-1 px-2 pt-1 group-data-[collapsible=icon]:grid-cols-1 group-data-[collapsible=icon]:justify-items-center group-data-[collapsible=icon]:px-0"
		>
			{STUDIO_NAV_ITEMS.map((item) => {
				const isActive = pathname === item.href;
				return (
					<Tooltip key={item.href}>
						<TooltipTrigger asChild>
							<Link
								href={withOrg(item.href)}
								prefetch={true}
								aria-label={item.tooltip}
								aria-current={isActive ? "page" : undefined}
								data-active={isActive}
								onClick={() => {
									if (isMobile) {
										setOpenMobile(false);
									}
								}}
								className={cn(
									"flex flex-col items-center gap-1 rounded-md px-1 py-2 text-[11px] leading-none text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none",
									"data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground",
									"group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0",
								)}
							>
								<item.icon className="h-4 w-4 shrink-0" />
								<span className="max-w-full truncate group-data-[collapsible=icon]:hidden">
									{item.label}
								</span>
							</Link>
						</TooltipTrigger>
						{/* Expanded tiles already show a label; a hover tooltip there
						    covers the neighboring tile and steals its clicks. */}
						<TooltipContent
							side="right"
							hidden={state !== "collapsed" || isMobile}
						>
							{item.tooltip}
						</TooltipContent>
					</Tooltip>
				);
			})}
		</nav>
	);
}
