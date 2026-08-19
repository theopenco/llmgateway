"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	Activity,
	AlertTriangle,
	BarChart3,
	Building2,
	Cpu,
	Gauge,
	GitMerge,
	KeyRound,
	LayoutDashboard,
	LogOut,
	Mail,
	Menu,
	MessageCircle,
	MessageSquare,
	Percent,
	Route,
	Server,
	Settings,
	ShieldAlert,
	Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { ThemeToggle } from "@/components/landing/theme-toggle";
import { Button } from "@/components/ui/button";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarTrigger,
	useSidebar,
} from "@/components/ui/sidebar";
import { useUser } from "@/hooks/useUser";
import { useAuth } from "@/lib/auth-client";

import { Logo } from "./ui/logo";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface NavItem {
	href: string;
	label: string;
	icon: LucideIcon;
	/**
	 * "prefix" highlights the entry on its detail routes too; "exact" keeps the
	 * highlight on the index page only.
	 */
	match: "exact" | "prefix";
}

const navItems: NavItem[] = [
	{ href: "/", label: "Dashboard", icon: LayoutDashboard, match: "exact" },
	{
		href: "/organizations",
		label: "Organizations",
		icon: Building2,
		match: "prefix",
	},
	{ href: "/devpass", label: "DevPass", icon: Sparkles, match: "prefix" },
	{
		href: "/chat-plans",
		label: "Lounge Plans",
		icon: MessageSquare,
		match: "prefix",
	},
	{
		href: "/global-stats",
		label: "Global Stats",
		icon: BarChart3,
		match: "prefix",
	},
	{ href: "/discounts", label: "Discounts", icon: Percent, match: "exact" },
	{
		href: "/rate-limits",
		label: "Global Rate Limits",
		icon: Gauge,
		match: "exact",
	},
	{ href: "/providers", label: "Providers", icon: Server, match: "exact" },
	{
		href: "/provider-credentials",
		label: "Provider Credentials",
		icon: KeyRound,
		match: "prefix",
	},
	{ href: "/models", label: "Models", icon: Cpu, match: "exact" },
	{
		href: "/model-provider-mappings",
		label: "Model Mappings",
		icon: GitMerge,
		match: "exact",
	},
	{
		href: "/routing-analytics",
		label: "Routing Analytics",
		icon: Route,
		match: "prefix",
	},
	{
		href: "/unstable-mappings",
		label: "Unstable Mappings",
		icon: Activity,
		match: "prefix",
	},
	{
		href: "/contact-submissions",
		label: "Contact Submissions",
		icon: Mail,
		match: "prefix",
	},
	{
		href: "/provider-listing-requests",
		label: "Provider Requests",
		icon: Building2,
		match: "prefix",
	},
	{
		href: "/chat-support-logs",
		label: "Chat Support Logs",
		icon: MessageCircle,
		match: "prefix",
	},
	{
		href: "/payment-failures",
		label: "Payment Failures",
		icon: AlertTriangle,
		match: "prefix",
	},
	{
		href: "/flagged-accounts",
		label: "Flagged Accounts",
		icon: ShieldAlert,
		match: "prefix",
	},
	{
		href: "/limit-hits",
		label: "Limit Hits",
		icon: ShieldAlert,
		match: "prefix",
	},
	{ href: "/settings", label: "Settings", icon: Settings, match: "exact" },
];

function isActive(item: NavItem, pathname: string): boolean {
	if (item.href === "/") {
		return pathname === "/" || pathname === "";
	}
	return item.match === "exact"
		? pathname === item.href
		: pathname.startsWith(item.href);
}

interface AdminShellProps {
	children: ReactNode;
	/**
	 * Server-rendered session-cookie presence. Used only as the fallback while
	 * `/user/me` is still in flight, so the navigation does not flash in or out
	 * on every full page load.
	 */
	signedIn: boolean;
}

function MobileHeader() {
	const { toggleSidebar } = useSidebar();

	return (
		<header className="sticky top-0 z-40 flex h-14 items-center gap-4 border-b border-border/60 bg-background px-4 md:hidden">
			<Button
				variant="ghost"
				size="icon"
				className="h-9 w-9"
				onClick={toggleSidebar}
			>
				<Menu className="h-5 w-5" />
				<span className="sr-only">Toggle menu</span>
			</Button>
			<div className="flex items-center gap-2">
				<div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
					<Logo className="h-4 w-4" />
				</div>
				<div className="flex flex-col">
					<span className="text-sm font-semibold leading-tight">
						LLM Gateway
					</span>
					<span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
						Admin
					</span>
				</div>
			</div>
			<ThemeToggle size="compact" className="ml-auto" />
		</header>
	);
}

export function AdminShell({ children, signedIn }: AdminShellProps) {
	const pathname = usePathname();
	const router = useRouter();
	const { signOut } = useAuth();
	const queryClient = useQueryClient();
	const { user, isLoading, error } = useUser();

	// Visitors without an admin session never see the navigation: the section
	// list would suggest there is something reachable behind it, and a sign out
	// button makes no sense when nobody is signed in.
	const showNav = user ? user.isAdmin : isLoading && !error && signedIn;

	if (!showNav) {
		return (
			<div className="relative min-h-svh w-full">
				<div className="absolute right-4 top-4 z-50">
					<ThemeToggle size="compact" />
				</div>
				{children}
			</div>
		);
	}

	const handleSignOut = async () => {
		await signOut({
			fetchOptions: {
				onSuccess: () => {
					queryClient.clear();
					router.push("/login");
				},
			},
		});
	};

	return (
		<SidebarProvider>
			<Sidebar variant="inset">
				<SidebarHeader className="border-b border-sidebar-border/60">
					<div className="flex h-12 items-center justify-between px-2">
						<div className="flex items-center gap-2 px-1">
							<div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
								<Logo className="h-4 w-4" />
							</div>
							<div className="flex flex-col">
								<span className="text-sm font-semibold leading-tight">
									LLM Gateway
								</span>
								<span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
									Admin
								</span>
							</div>
						</div>
						<SidebarTrigger className="hidden md:flex" />
					</div>
				</SidebarHeader>
				<SidebarContent>
					<SidebarGroup>
						<SidebarGroupLabel>Main</SidebarGroupLabel>
						<SidebarMenu>
							{navItems.map((item) => {
								const Icon = item.icon;
								return (
									<SidebarMenuItem key={item.href}>
										<Link href={item.href} prefetch={true} className="block">
											<SidebarMenuButton
												isActive={isActive(item, pathname)}
												size="lg"
											>
												<Icon className="h-4 w-4" />
												<span>{item.label}</span>
											</SidebarMenuButton>
										</Link>
									</SidebarMenuItem>
								);
							})}
						</SidebarMenu>
					</SidebarGroup>
				</SidebarContent>
				<SidebarFooter className="border-t border-sidebar-border/60">
					<div className="flex justify-center">
						<ThemeToggle size="compact" />
					</div>
					<Button
						variant="ghost"
						size="sm"
						className="w-full justify-start gap-2 text-xs text-muted-foreground"
						onClick={handleSignOut}
					>
						<LogOut className="h-3.5 w-3.5" />
						<span>Sign out</span>
					</Button>
				</SidebarFooter>
			</Sidebar>
			<SidebarInset>
				<MobileHeader />
				{children}
			</SidebarInset>
		</SidebarProvider>
	);
}
