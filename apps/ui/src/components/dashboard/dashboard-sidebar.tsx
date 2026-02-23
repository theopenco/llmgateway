"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	ChevronUp,
	ComputerIcon,
	CreditCard,
	ExternalLink,
	MoonIcon,
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
import {
	AnimatedActivity,
	AnimatedBarChart3,
	AnimatedBotMessageSquare,
	AnimatedChartColumnBig,
	AnimatedExternalLink,
	AnimatedKey,
	AnimatedKeyRound,
	AnimatedLayoutDashboard,
	AnimatedMessageSquare,
	AnimatedSettings,
	AnimatedShield,
	AnimatedShieldAlert,
} from "@/components/dashboard/animated-nav-icons";
import { ReferralDialog } from "@/components/dashboard/referral-dialog";
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
	SidebarRail,
	useSidebar,
} from "@/lib/components/sidebar";
import Logo from "@/lib/icons/Logo";
import { buildUrlWithParams } from "@/lib/navigation-utils";

import { OrganizationSwitcher } from "./organization-switcher";

import type { AnimatedIconProps } from "@/components/dashboard/animated-nav-icons";
import type { Organization, User } from "@/lib/types";
import type { Route } from "next";

type AnimatedIconComponent = React.ComponentType<AnimatedIconProps>;

// Configuration
const PROJECT_NAVIGATION: readonly {
	href: string;
	label: string;
	icon: AnimatedIconComponent;
}[] = [
	{
		href: "",
		label: "Dashboard",
		icon: AnimatedLayoutDashboard,
	},
	{
		href: "activity",
		label: "Activity",
		icon: AnimatedActivity,
	},
	{
		href: "model-usage",
		label: "Model Usage",
		icon: AnimatedChartColumnBig,
	},
	{
		href: "usage",
		label: "Usage & Metrics",
		icon: AnimatedBarChart3,
	},
	{
		href: "api-keys",
		label: "API Keys",
		icon: AnimatedKey,
	},
];

const PROJECT_SETTINGS = [
	{
		href: "settings/preferences",
		label: "Preferences",
	},
] as const;

const ORGANIZATION_SETTINGS = [
	{
		href: "org/billing",
		label: "Billing",
		search: { success: undefined, canceled: undefined },
	},
	{
		href: "org/transactions",
		label: "Transactions",
	},
	{
		href: "org/referrals",
		label: "Referrals",
	},
	{
		href: "org/policies",
		label: "Policies",
	},
	{
		href: "org/preferences",
		label: "Preferences",
	},
	{
		href: "org/team",
		label: "Team",
	},
	{
		href: "org/audit-logs",
		label: "Audit Logs",
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
		href: "org/billing",
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
			<SidebarMenu>
				<SidebarMenuItem>
					<SidebarMenuButton size="lg" asChild tooltip="LLM Gateway">
						<Link href={buildUrl()} prefetch={true}>
							<div className="flex aspect-square size-8 items-center justify-center">
								<Logo className="size-6 text-black dark:text-white" />
							</div>
							<span className="text-lg font-bold tracking-tight">
								LLM Gateway
							</span>
						</Link>
					</SidebarMenuButton>
				</SidebarMenuItem>
			</SidebarMenu>
			<div className="group-data-[collapsible=icon]:hidden">
				<OrganizationSwitcher
					organizations={organizations}
					selectedOrganization={selectedOrganization}
					onSelectOrganization={onSelectOrganization}
					onOrganizationCreated={onOrganizationCreated}
				/>
			</div>
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
	const [isHovered, setIsHovered] = useState(false);

	return (
		<SidebarMenuItem
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
		>
			<SidebarMenuButton
				asChild
				isActive={isActive(item.href)}
				tooltip={item.label}
			>
				<Link href={href} onClick={onClick} prefetch={true}>
					<item.icon isHovered={isHovered} />
					<span>{item.label}</span>
				</Link>
			</SidebarMenuButton>
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
	const [isHovered, setIsHovered] = useState(false);

	return (
		<SidebarMenuItem
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
		>
			<SidebarMenuButton
				asChild
				isActive={isActive("settings/preferences")}
				tooltip="Settings"
			>
				<Link
					href={buildUrl("settings/preferences")}
					onClick={() => {
						if (isMobile) {
							toggleSidebar();
						}
					}}
					prefetch={true}
				>
					<AnimatedSettings isHovered={isHovered} />
					<span>Settings</span>
				</Link>
			</SidebarMenuButton>
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

function OrgNavItem({
	href,
	label,
	icon: Icon,
	isActive,
	isMobile,
	toggleSidebar,
}: {
	href: string;
	label: string;
	icon: AnimatedIconComponent;
	isActive: boolean;
	isMobile: boolean;
	toggleSidebar: () => void;
}) {
	const [isHovered, setIsHovered] = useState(false);

	return (
		<SidebarMenuItem
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
		>
			<SidebarMenuButton asChild isActive={isActive} tooltip={label}>
				<Link
					href={href as Route}
					onClick={() => {
						if (isMobile) {
							toggleSidebar();
						}
					}}
					prefetch={true}
				>
					<Icon isHovered={isHovered} />
					<span>{label}</span>
				</Link>
			</SidebarMenuButton>
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
	const { buildOrgUrl } = useDashboardNavigation();
	const [settingsHovered, setSettingsHovered] = useState(false);

	return (
		<SidebarGroup>
			<SidebarGroupLabel className="text-muted-foreground px-2 text-xs font-medium">
				Organization
			</SidebarGroupLabel>
			<SidebarGroupContent className="mt-2">
				<SidebarMenu>
					<OrgNavItem
						href={buildOrgUrl("org/provider-keys")}
						label="Provider Keys"
						icon={AnimatedKeyRound}
						isActive={isActive("org/provider-keys")}
						isMobile={isMobile}
						toggleSidebar={toggleSidebar}
					/>
					<OrgNavItem
						href={buildOrgUrl("org/guardrails")}
						label="Guardrails"
						icon={AnimatedShield}
						isActive={isActive("org/guardrails")}
						isMobile={isMobile}
						toggleSidebar={toggleSidebar}
					/>
					<OrgNavItem
						href={buildOrgUrl("org/security-events")}
						label="Security Events"
						icon={AnimatedShieldAlert}
						isActive={isActive("org/security-events")}
						isMobile={isMobile}
						toggleSidebar={toggleSidebar}
					/>
					<SidebarMenuItem
						onMouseEnter={() => setSettingsHovered(true)}
						onMouseLeave={() => setSettingsHovered(false)}
					>
						<SidebarMenuButton
							asChild
							isActive={
								isActive("org/billing") ||
								isActive("org/transactions") ||
								isActive("org/referrals") ||
								isActive("org/policies") ||
								isActive("org/preferences") ||
								isActive("org/team") ||
								isActive("org/audit-logs")
							}
							tooltip="Settings"
						>
							<Link
								href={buildOrgUrl("org/billing")}
								onClick={() => {
									if (isMobile) {
										toggleSidebar();
									}
								}}
								prefetch={true}
							>
								<AnimatedSettings isHovered={settingsHovered} />
								<span>Settings</span>
							</Link>
						</SidebarMenuButton>
						<SidebarMenuSub className="ml-7">
							{ORGANIZATION_SETTINGS.map((item) => (
								<SidebarMenuSubItem key={item.href}>
									<SidebarMenuSubButton asChild isActive={isActive(item.href)}>
										<Link
											href={
												"search" in item
													? (buildUrlWithParams(
															buildOrgUrl(item.href),
															searchParams,
															item.search,
														) as Route)
													: buildOrgUrl(item.href)
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

function ToolsResourceItem({
	item,
	isActive,
	isMobile,
	toggleSidebar,
}: {
	item: {
		href: string;
		label: string;
		icon: AnimatedIconComponent;
		internal: boolean;
	};
	isActive: (path: string) => boolean;
	isMobile: boolean;
	toggleSidebar: () => void;
}) {
	const [isHovered, setIsHovered] = useState(false);

	return (
		<SidebarMenuItem
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
		>
			{item.internal ? (
				<SidebarMenuButton
					asChild
					isActive={isActive(item.href)}
					tooltip={item.label}
				>
					<Link
						href={item.href as Route}
						onClick={() => {
							if (isMobile) {
								toggleSidebar();
							}
						}}
						prefetch={true}
					>
						<item.icon isHovered={isHovered} />
						<span>{item.label}</span>
					</Link>
				</SidebarMenuButton>
			) : (
				<SidebarMenuButton asChild tooltip={item.label}>
					<a
						href={item.href}
						target="_blank"
						rel="noopener noreferrer"
						onClick={() => {
							if (isMobile) {
								toggleSidebar();
							}
						}}
					>
						<item.icon isHovered={isHovered} />
						<span>{item.label}</span>
						<ExternalLink className="ml-auto h-3 w-3 group-data-[collapsible=icon]:hidden" />
					</a>
				</SidebarMenuButton>
			)}
		</SidebarMenuItem>
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
		icon: AnimatedIconComponent;
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
						<ToolsResourceItem
							key={item.href}
							item={item}
							isActive={isActive}
							isMobile={isMobile}
							toggleSidebar={toggleSidebar}
						/>
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
		<div className="px-2 py-1.5 group-data-[collapsible=icon]:hidden">
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
	const { buildUrl, buildOrgUrl } = useDashboardNavigation();
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
					<div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
						<span className="truncate font-semibold">{user?.name}</span>
						<span className="truncate text-xs text-muted-foreground">
							{user?.email}
						</span>
					</div>
					<ChevronUp className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
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
				{USER_MENU_ITEMS.map((item) => {
					// Use buildOrgUrl for billing, buildUrl for other items
					const urlBuilder =
						item.href === "org/billing" ? buildOrgUrl : buildUrl;
					return (
						<DropdownMenuItem key={item.href} asChild>
							<Link
								href={
									"search" in item
										? (buildUrlWithParams(
												urlBuilder(item.href),
												searchParams,
												item.search,
											) as Route)
										: urlBuilder(item.href)
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
					);
				})}
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={onLogout}>
					<span>Log out</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function useInviteBannerEligible(
	selectedOrganization: Organization | null,
): boolean {
	const [eligible, setEligible] = useState(false);

	useEffect(() => {
		if (!selectedOrganization) {
			return;
		}

		// Check if user has been active for at least 7 days
		const orgCreatedAt = new Date(selectedOrganization.createdAt);
		const daysSinceCreation =
			(Date.now() - orgCreatedAt.getTime()) / (1000 * 60 * 60 * 24);
		if (daysSinceCreation >= 7) {
			setEligible(true);
			return;
		}

		// Check if user has purchased credits (credits > 0)
		if (Number(selectedOrganization.credits) > 0) {
			setEligible(true);
			return;
		}

		// Check if user has made 50+ API calls (set by dashboard)
		const hasEnoughCalls =
			localStorage.getItem("user_has_50_plus_calls") === "true";
		if (hasEnoughCalls) {
			setEligible(true);
			return;
		}

		setEligible(false);
	}, [selectedOrganization]);

	return eligible;
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
	const eligible = useInviteBannerEligible(selectedOrganization);

	if (!show || !selectedOrganization || !eligible) {
		return null;
	}

	return (
		<div className="px-4 py-2 group-data-[collapsible=icon]:hidden">
			<div className="rounded-lg bg-linear-to-r from-blue-500 to-purple-600 p-4 text-white">
				<div className="flex items-start justify-between">
					<div className="flex-1">
						<h3 className="text-sm font-semibold">Invite your friends</h3>
						<p className="text-xs text-blue-100 mt-1">
							Invite friends and teammates and earn bonus credits
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
				<ReferralDialog selectedOrganization={selectedOrganization}>
					<Button
						variant="secondary"
						size="sm"
						className="mt-2 w-full bg-white text-blue-600 hover:bg-blue-50"
					>
						Invite &amp; earn
					</Button>
				</ReferralDialog>
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
			return pathname.match(/^\/dashboard\/[^/]+\/[^/]+$/) !== null;
		}
		// For other paths, check if pathname ends with the path
		return pathname.endsWith(`/${path}`);
	};

	const toolsResources = useMemo(
		() => [
			{
				href: "/models",
				label: "Supported Models",
				icon: AnimatedMessageSquare,
				internal: true,
			},
			{
				href:
					process.env.NODE_ENV === "development"
						? "http://localhost:3003"
						: "https://chat.llmgateway.io",
				label: "Chat",
				icon: AnimatedBotMessageSquare,
				internal: false,
			},
			{
				href: "https://docs.llmgateway.io",
				label: "Documentation",
				icon: AnimatedExternalLink,
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
			<SidebarRail />
		</Sidebar>
	);
}
