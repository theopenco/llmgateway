"use client";

import { ArrowUpRight, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useCompany } from "@/components/dashboard/company-context";
import {
	getNavGroups,
	isNavItemActive,
	type NavBadges,
	type NavItem,
} from "@/components/dashboard/nav";
import { Logo } from "@/components/Logo";
import { ProductSwitcher } from "@/components/ProductSwitcher";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	useSidebar,
} from "@/components/ui/sidebar";
import { UserMenu } from "@/components/UserMenu";
import { useAppConfig } from "@/lib/config";

function NavLink({
	item,
	active,
	badge,
	onNavigate,
}: {
	item: NavItem;
	active: boolean;
	badge?: number;
	onNavigate: () => void;
}) {
	const Icon = item.icon;
	const showBadge = typeof badge === "number" && badge > 0;

	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				asChild
				isActive={active}
				tooltip={
					showBadge && !item.external ? `${item.label} (${badge})` : item.label
				}
				className="data-[active=true]:text-primary data-[active=true]:bg-primary/12 dark:data-[active=true]:bg-primary/15"
			>
				{item.external ? (
					<a
						href={item.href}
						target="_blank"
						rel="noopener noreferrer"
						onClick={onNavigate}
					>
						<Icon />
						<span>{item.label}</span>
						<ArrowUpRight className="text-muted-foreground ml-auto size-3.5! group-data-[collapsible=icon]:hidden" />
					</a>
				) : (
					<Link
						href={item.href}
						aria-current={active ? "page" : undefined}
						onClick={onNavigate}
					>
						<Icon />
						<span>{item.label}</span>
					</Link>
				)}
			</SidebarMenuButton>
			{showBadge ? (
				<span
					aria-hidden="true"
					className="bg-primary ring-sidebar pointer-events-none absolute top-1 right-1 hidden size-2 rounded-full ring-2 group-data-[collapsible=icon]:block"
				/>
			) : null}
			{showBadge ? (
				<SidebarMenuBadge className="bg-primary text-primary-foreground peer-hover/menu-button:text-primary-foreground peer-data-[active=true]/menu-button:text-primary-foreground rounded-full font-mono text-[0.65rem]">
					{badge > 99 ? "99+" : badge}
				</SidebarMenuBadge>
			) : null}
		</SidebarMenuItem>
	);
}

function CompanySwitcher() {
	const { companies, company, setCompanyId } = useCompany();

	if (companies.length === 0) {
		return null;
	}

	return (
		<div className="flex flex-col gap-1.5 px-2 group-data-[collapsible=icon]:hidden">
			<span className="text-muted-foreground font-mono text-[0.65rem] tracking-wider uppercase">
				Company
			</span>
			<Select
				value={company?.id ?? ""}
				onValueChange={(value) => setCompanyId(value)}
			>
				<SelectTrigger
					size="sm"
					className="bg-background w-full font-mono text-xs"
					data-testid="company-select"
				>
					<SelectValue placeholder="Company" />
				</SelectTrigger>
				<SelectContent>
					{companies.map((c) => (
						<SelectItem key={c.id} value={c.id}>
							{c.displayName}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

export function AirsideSidebar({ badges = {} }: { badges?: NavBadges }) {
	const pathname = usePathname();
	const config = useAppConfig();
	const { isMobile, state, setOpenMobile } = useSidebar();
	const groups = getNavGroups(config.uiUrl);

	function handleNavigate() {
		if (isMobile) {
			setOpenMobile(false);
		}
	}

	return (
		<Sidebar variant="inset" collapsible="icon">
			<SidebarHeader className="gap-3">
				<SidebarMenu>
					<SidebarMenuItem>
						<ProductSwitcher
							side={isMobile || state === "expanded" ? "bottom" : "right"}
						>
							<SidebarMenuButton
								size="lg"
								className="data-[state=open]:bg-sidebar-accent"
							>
								<Logo className="size-8 shrink-0" />
								<span className="grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
									<span className="font-display truncate text-base font-black tracking-tight">
										AIRSIDE
									</span>
									<span className="text-muted-foreground truncate font-mono text-[0.65rem] tracking-wider uppercase">
										Provider console
									</span>
								</span>
								<ChevronsUpDown
									className="text-muted-foreground ml-auto size-4 shrink-0 group-data-[collapsible=icon]:hidden"
									aria-hidden="true"
								/>
							</SidebarMenuButton>
						</ProductSwitcher>
					</SidebarMenuItem>
				</SidebarMenu>
				<CompanySwitcher />
			</SidebarHeader>

			<SidebarContent>
				{groups.map((group) => (
					<SidebarGroup key={group.label}>
						<SidebarGroupLabel className="font-mono text-[0.65rem] tracking-wider uppercase">
							{group.label}
						</SidebarGroupLabel>
						<SidebarGroupContent>
							<SidebarMenu>
								{group.items.map((item) => (
									<NavLink
										key={item.href}
										item={item}
										active={isNavItemActive(item, pathname)}
										badge={badges[item.href]}
										onNavigate={handleNavigate}
									/>
								))}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				))}
			</SidebarContent>

			<SidebarFooter>
				<SidebarMenu>
					<SidebarMenuItem>
						<UserMenu />
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
