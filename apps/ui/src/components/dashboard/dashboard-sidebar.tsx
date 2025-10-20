"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	Activity,
	BarChart3,
	BotMessageSquare,
	ChartColumnBig,
	ChevronUp,
	ComputerIcon,
	CreditCard,
	ExternalLink,
	Key,
	KeyRound,
	LayoutDashboard,
	MessageSquare,
	MoonIcon,
	Settings,
	Shield,
	SunIcon,
	User as UserIcon,
	X,
} from "lucide-react";
import Link from "next/link";
import {
	usePathname,
	useRouter,
	useSearchParams,
	type ReadonlyURLSearchParams,
} from "next/navigation";
import { useTheme } from "next-themes";
import { usePostHog } from "posthog-js/react";
import { useMemo, useState, useEffect } from "react";

import { TopUpCreditsDialog } from "@/components/credits/top-up-credits-dialog";
import { UpgradeToProDialog } from "@/components/shared/upgrade-to-pro-dialog";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { useUser } from "@/hooks/useUser";
import { clearLastUsedProjectCookiesAction } from "@/lib/actions/last-used-project";
import { useAuth } from "@/lib/auth-client";
import { Button } from "@/lib/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/lib/components/dropdown-menu";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
	useSidebar,
} from "@/lib/components/sidebar";
import Logo from "@/lib/icons/Logo";
import { buildUrlWithParams } from "@/lib/navigation-utils";
import { cn } from "@/lib/utils";

import { OrganizationSwitcher } from "./organization-switcher";

import type { Organization, User } from "@/lib/types";
import type { LucideIcon } from "lucide-react";

// Configuration
const PROJECT_NAVIGATION = [
	{
		href: "",
		label: "Dashboard",
		icon: LayoutDashboard,
	},
	{
		href: "activity",
		label: "Activity",
		icon: Activity,
	},
	{
		href: "model-usage",
		label: "Model Usage",
		icon: ChartColumnBig,
	},
	{
		href: "usage",
		label: "Usage & Metrics",
		icon: BarChart3,
	},
	{
		href: "api-keys",
		label: "API Keys",
		icon: Key,
	},
] as const;

const PROJECT_SETTINGS = [
	{
		href: "settings/preferences",
		label: "Preferences",
	},
] as const;

const ORGANIZATION_SETTINGS = [
	{
		href: "settings/billing",
		label: "Billing",
		search: { success: undefined, canceled: undefined },
	},
	{
		href: "settings/transactions",
		label: "Transactions",
	},
	{
		href: "settings/policies",
		label: "Policies",
	},
	{
		href: "settings/team",
		label: "Team",
	},
] as const;

// TOOLS_RESOURCES will be created dynamically inside the component

const USER_MENU_ITEMS = [
	{
		href: "settings/account",
		label: "Account",
		icon: UserIcon,
	},
	{
		href: "settings/billing",
		label: "Billing",
		icon: CreditCard,
		search: { success: undefined, canceled: undefined },
	},
	{
		href: "settings/security",
		label: "Security",
		icon: Shield,
	},
] as const;

interface DashboardSidebarProps {
	organizations: Organization[];
	onSelectOrganization: (org: Organization | null) => void;
	onOrganizationCreated: (org: Organization) => void;
	selectedOrganization: Organization | null;
}

// Sub-components
function DashboardSidebarHeader({
	organizations,
	selectedOrganization,
	onSelectOrganization,
	onOrganizationCreated,
}: {
	organizations: Organization[];
	selectedOrganization: Organization | null;
	onSelectOrganization: (org: Organization | null) => void;
	onOrganizationCreated: (org: Organization) => void;
}) {
	const { buildUrl } = useDashboardNavigation();

	return (
		<SidebarHeader>
			<div className="flex h-14 items-center px-4">
				<Link
					href={buildUrl()}
					className="inline-flex items-center space-x-2"
					prefetch={true}
				>
					<Logo className="h-8 w-8 rounded-full text-black dark:text-white" />
					<span className="text-xl font-bold tracking-tight">LLM Gateway</span>
				</Link>
			</div>
			<OrganizationSwitcher
				organizations={organizations}
				selectedOrganization={selectedOrganization}
				onSelectOrganization={onSelectOrganization}
				onOrganizationCreated={onOrganizationCreated}
			/>
		</SidebarHeader>
	);
}

function NavigationItem({
	item,
	isActive,
	onClick,
}: {
	item: (typeof PROJECT_NAVIGATION)[number];
	isActive: (path: string) => boolean;
	onClick: () => void;
}) {
	const { buildUrl } = useDashboardNavigation();
	const href = buildUrl(item.href);

	return (
		<SidebarMenuItem>
			<Link
				href={href}
				className={cn(
					"flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
					isActive(item.href)
						? "bg-primary/10 text-primary"
						: "text-foreground/70 hover:bg-accent hover:text-accent-foreground",
				)}
				onClick={onClick}
				prefetch={true}
			>
				<item.icon className="h-4 w-4" />
				<span>{item.label}</span>
			</Link>
		</SidebarMenuItem>
	);
}

function ProjectSettingsSection({
	isActive,
	isMobile,
	toggleSidebar,
}: {
	isActive: (path: string) => boolean;
	isMobile: boolean;
	toggleSidebar: () => void;
}) {
	const { buildUrl } = useDashboardNavigation();

	return (
		<SidebarMenuItem>
			<div
				className={cn(
					"flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
					isActive("settings/preferences")
						? "bg-primary/10 text-primary"
						: "text-foreground/70 hover:bg-accent hover:text-accent-foreground",
				)}
			>
				<Settings className="h-4 w-4" />
				<span>Settings</span>
			</div>
			<SidebarMenuSub className="ml-7">
				{PROJECT_SETTINGS.map((item) => (
					<SidebarMenuSubItem key={item.href}>
						<SidebarMenuSubButton asChild isActive={isActive(item.href)}>
							<Link
								href={buildUrl(item.href)}
								onClick={() => {
									if (isMobile) {
										toggleSidebar();
									}
								}}
								prefetch={true}
							>
								<span>{item.label}</span>
							</Link>
						</SidebarMenuSubButton>
					</SidebarMenuSubItem>
				))}
			</SidebarMenuSub>
		</SidebarMenuItem>
	);
}

function OrganizationSection({
	isActive,
	isMobile,
	toggleSidebar,
	searchParams,
}: {
	isActive: (path: string) => boolean;
	isMobile: boolean;
	toggleSidebar: () => void;
	searchParams: ReadonlyURLSearchParams;
}) {
	const { buildUrl } = useDashboardNavigation();

	return (
		<SidebarGroup>
			<SidebarGroupLabel className="text-muted-foreground px-2 text-xs font-medium">
				Organization
			</SidebarGroupLabel>
			<SidebarGroupContent className="mt-2">
				<SidebarMenu>
					<SidebarMenuItem>
						<Link
							href={buildUrl("provider-keys")}
							className={cn(
								"flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
								isActive("provider-keys")
									? "bg-primary/10 text-primary"
									: "text-foreground/70 hover:bg-accent hover:text-accent-foreground",
							)}
							onClick={() => {
								if (isMobile) {
									toggleSidebar();
								}
							}}
							prefetch={true}
						>
							<KeyRound className="h-4 w-4" />
							<span>Provider Keys</span>
						</Link>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<div
							className={cn(
								"flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
								isActive("settings/billing") ||
									isActive("settings/transactions") ||
									isActive("settings/policies") ||
									isActive("settings/team")
									? "bg-primary/10 text-primary"
									: "text-foreground/70 hover:bg-accent hover:text-accent-foreground",
							)}
						>
							<Settings className="h-4 w-4" />
							<span>Settings</span>
						</div>
						<SidebarMenuSub className="ml-7">
							{ORGANIZATION_SETTINGS.map((item) => (
								<SidebarMenuSubItem key={item.href}>
									<SidebarMenuSubButton asChild isActive={isActive(item.href)}>
										<Link
											href={
												"search" in item
													? buildUrlWithParams(
															buildUrl(item.href),
															searchParams,
															item.search,
														)
													: buildUrl(item.href)
											}
											onClick={() => {
												if (isMobile) {
													toggleSidebar();
												}
											}}
											prefetch={true}
										>
											<span>{item.label}</span>
										</Link>
									</SidebarMenuSubButton>
								</SidebarMenuSubItem>
							))}
						</SidebarMenuSub>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}

function ToolsResourcesSection({
	toolsResources,
	isActive,
	isMobile,
	toggleSidebar,
}: {
	toolsResources: readonly {
		href: string;
		label: string;
		icon: LucideIcon;
		internal: boolean;
	}[];
	isActive: (path: string) => boolean;
	isMobile: boolean;
	toggleSidebar: () => void;
}) {
	return (
		<SidebarGroup>
			<SidebarGroupLabel className="text-muted-foreground px-2 text-xs font-medium">
				Tools & Resources
			</SidebarGroupLabel>
			<SidebarGroupContent className="mt-2">
				<SidebarMenu>
					{toolsResources.map((item) => (
						<SidebarMenuItem key={item.href}>
							{item.internal ? (
								<Link
									href={item.href}
									className={cn(
										"flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
										isActive(item.href)
											? "bg-primary/10 text-primary"
											: "text-foreground/70 hover:bg-accent hover:text-accent-foreground",
									)}
									onClick={() => {
										if (isMobile) {
											toggleSidebar();
										}
									}}
									prefetch={true}
								>
									<item.icon className="h-4 w-4" />
									<span>{item.label}</span>
								</Link>
							) : (
								<a
									href={item.href}
									target="_blank"
									rel="noopener noreferrer"
									className={cn(
										"flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
										"text-foreground/70 hover:bg-accent hover:text-accent-foreground",
									)}
									onClick={() => {
										if (isMobile) {
											toggleSidebar();
										}
									}}
								>
									<item.icon className="h-4 w-4" />
									<span>{item.label}</span>
									<ExternalLink className="ml-auto h-3 w-3" />
								</a>
							)}
						</SidebarMenuItem>
					))}
				</SidebarMenu>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}

function CreditsDisplay({
	selectedOrganization,
}: {
	selectedOrganization: Organization | null;
}) {
	const creditsBalance = selectedOrganization
		? Number(selectedOrganization.credits).toFixed(2)
		: "0.00";

	return (
		<div className="px-2 py-1.5">
			<TopUpCreditsDialog>
				<button className="w-full flex items-center justify-between p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors text-left">
					<div className="flex items-center gap-2">
						<CreditCard className="h-4 w-4 text-muted-foreground" />
						<div className="flex flex-col">
							<span className="text-sm font-medium">Credits</span>
							<span className="text-xs text-muted-foreground">
								${creditsBalance}
							</span>
						</div>
					</div>
					<span className="text-xs text-muted-foreground">Add</span>
				</button>
			</TopUpCreditsDialog>
		</div>
	);
}

function ThemeSelect() {
	const { theme, setTheme } = useTheme();

	return (
		<Select value={theme} onValueChange={setTheme}>
			<SelectTrigger className="w-full">
				<SelectValue placeholder="Select theme" />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="light">
					<div className="flex items-center">
						<SunIcon className="mr-2 h-4 w-4" />
						Light
					</div>
				</SelectItem>
				<SelectItem value="dark">
					<div className="flex items-center">
						<MoonIcon className="mr-2 h-4 w-4" />
						Dark
					</div>
				</SelectItem>
				<SelectItem value="system">
					<div className="flex items-center">
						<ComputerIcon className="mr-2 h-4 w-4" />
						System
					</div>
				</SelectItem>
			</SelectContent>
		</Select>
	);
}

function UserDropdownMenu({
	user,
	isMobile,
	toggleSidebar,
	onLogout,
}: {
	user: User;
	isMobile: boolean;
	toggleSidebar: () => void;
	onLogout: () => void;
}) {
	const { buildUrl } = useDashboardNavigation();
	const searchParams = useSearchParams();

	const getUserInitials = () => {
		if (!user?.name) {
			return "U";
		}
		return user.name
			.split(" ")
			.map((n: string) => n[0])
			.join("")
			.toUpperCase()
			.slice(0, 2);
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<SidebarMenuButton
					size="lg"
					className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
				>
					<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
						<span className="text-xs font-semibold">{getUserInitials()}</span>
					</div>
					<div className="grid flex-1 text-left text-sm leading-tight">
						<span className="truncate font-semibold">{user?.name}</span>
						<span className="truncate text-xs text-muted-foreground">
							{user?.email}
						</span>
					</div>
					<ChevronUp className="ml-auto size-4" />
				</SidebarMenuButton>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
				side="top"
				align="end"
				sideOffset={4}
			>
				<div className="p-2">
					<ThemeSelect />
				</div>
				<DropdownMenuSeparator />
				{USER_MENU_ITEMS.map((item) => (
					<DropdownMenuItem key={item.href} asChild>
						<Link
							href={
								"search" in item
									? buildUrlWithParams(
											buildUrl(item.href),
											searchParams,
											item.search,
										)
									: buildUrl(item.href)
							}
							onClick={() => {
								if (isMobile) {
									toggleSidebar();
								}
							}}
							prefetch={true}
						>
							<item.icon className="mr-2 h-4 w-4" />
							{item.label}
						</Link>
					</DropdownMenuItem>
				))}
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={onLogout}>
					<span>Log out</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function UpgradeCTA({
	show,
	onHide,
	selectedOrganization,
}: {
	show: boolean;
	onHide: () => void;
	selectedOrganization: Organization | null;
}) {
	if (!show || !selectedOrganization || selectedOrganization.plan === "pro") {
		return null;
	}

	return (
		<div className="px-4 py-2">
			<div className="rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 p-4 text-white">
				<div className="flex items-start justify-between">
					<div className="flex-1">
						<h3 className="text-sm font-semibold">Upgrade to Pro</h3>
						<p className="text-xs text-blue-100 mt-1">
							Unlock advanced features and priority support
						</p>
					</div>
					<Button
						variant="ghost"
						size="sm"
						onClick={onHide}
						className="h-6 w-6 p-0 text-white hover:bg-white/20"
					>
						<X className="h-3 w-3" />
					</Button>
				</div>
				<UpgradeToProDialog>
					<Button
						variant="secondary"
						size="sm"
						className="mt-2 w-full bg-white text-blue-600 hover:bg-blue-50"
					>
						Start your 7-day trial
					</Button>
				</UpgradeToProDialog>
			</div>
		</div>
	);
}

export function DashboardSidebar({
	organizations,
	onSelectOrganization,
	onOrganizationCreated,
	selectedOrganization,
}: DashboardSidebarProps) {
	const { isMobile, toggleSidebar } = useSidebar();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const router = useRouter();
	const posthog = usePostHog();
	const queryClient = useQueryClient();
	const { signOut } = useAuth();
	const [showUpgradeCTA, setShowUpgradeCTA] = useState(true);
	const [ctaLoaded, setCTALoaded] = useState(false);

	const { user } = useUser({
		redirectTo: "/login",
		redirectWhen: "unauthenticated",
	});

	// Check localStorage for dismissed CTA state after hydration
	useEffect(() => {
		const dismissed = localStorage.getItem("upgradeCTA_dismissed");
		if (dismissed) {
			try {
				const dismissedData = JSON.parse(dismissed);
				const now = Date.now();
				// Check if 2 weeks (14 days) have passed
				if (now - dismissedData.timestamp < 14 * 24 * 60 * 60 * 1000) {
					setShowUpgradeCTA(false); // Still within 2 weeks, keep hidden
				} else {
					// Expired, remove from localStorage
					localStorage.removeItem("upgradeCTA_dismissed");
				}
			} catch {
				// Invalid JSON, remove the item
				localStorage.removeItem("upgradeCTA_dismissed");
			}
		}
		setCTALoaded(true);
	}, []);

	// selectedOrganization is now passed as a prop from the layout

	// Update isActive function to work with new route structure
	const isActive = (path: string) => {
		if (path === "") {
			// For dashboard home, check if we're at the base dashboard route
			return pathname.match(/^\/dashboard\/[^\/]+\/[^\/]+$/) !== null;
		}
		// For other paths, check if pathname ends with the path
		return pathname.endsWith(`/${path}`);
	};

	const toolsResources = useMemo(
		() => [
			{
				href: "/models",
				label: "Supported Models",
				icon: MessageSquare,
				internal: true,
			},
			{
				href:
					process.env.NODE_ENV === "development"
						? "http://localhost:3003"
						: "https://chat.llmgateway.io",
				label: "Chat",
				icon: BotMessageSquare,
				internal: false,
			},
			{
				href: "https://docs.llmgateway.io",
				label: "Documentation",
				icon: ExternalLink,
				internal: false,
			},
		],
		[],
	);

	const hideCreditCTA = () => {
		setShowUpgradeCTA(false);
		// Persist dismissal in localStorage with timestamp
		if (typeof window !== "undefined") {
			localStorage.setItem(
				"upgradeCTA_dismissed",
				JSON.stringify({
					timestamp: Date.now(),
				}),
			);
		}
	};

	const logout = async () => {
		posthog.reset();

		// Clear last used project cookies before signing out
		try {
			await clearLastUsedProjectCookiesAction();
		} catch (error) {
			console.error("Failed to clear last used project cookies:", error);
		}

		await signOut({
			fetchOptions: {
				onSuccess: () => {
					queryClient.clear();
					router.push("/login");
				},
			},
		});
	};

	const handleNavClick = () => {
		if (isMobile) {
			toggleSidebar();
		}
	};

	if (!user) {
		return null;
	}

	return (
		<Sidebar variant="inset" collapsible="icon">
			<DashboardSidebarHeader
				organizations={organizations}
				selectedOrganization={selectedOrganization}
				onSelectOrganization={onSelectOrganization}
				onOrganizationCreated={onOrganizationCreated}
			/>
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel className="text-muted-foreground px-2 text-xs font-medium">
						Project
					</SidebarGroupLabel>
					<SidebarGroupContent className="mt-2">
						<SidebarMenu>
							{PROJECT_NAVIGATION.map((item) => (
								<NavigationItem
									key={item.href}
									item={item}
									isActive={isActive}
									onClick={handleNavClick}
								/>
							))}
							<ProjectSettingsSection
								isActive={isActive}
								isMobile={isMobile}
								toggleSidebar={toggleSidebar}
							/>
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>

				<OrganizationSection
					isActive={isActive}
					isMobile={isMobile}
					toggleSidebar={toggleSidebar}
					searchParams={searchParams}
				/>

				<ToolsResourcesSection
					toolsResources={toolsResources}
					isActive={isActive}
					isMobile={isMobile}
					toggleSidebar={toggleSidebar}
				/>
			</SidebarContent>

			<SidebarFooter>
				<CreditsDisplay selectedOrganization={selectedOrganization} />
				<UpgradeCTA
					show={showUpgradeCTA && ctaLoaded}
					onHide={hideCreditCTA}
					selectedOrganization={selectedOrganization}
				/>
				<SidebarMenu>
					<SidebarMenuItem>
						<UserDropdownMenu
							user={user}
							isMobile={isMobile}
							toggleSidebar={toggleSidebar}
							onLogout={logout}
						/>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>
		</Sidebar>
	);
}
