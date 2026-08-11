"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	ChevronUp,
	CreditCard,
	ExternalLink,
	LogOut,
	Sparkles,
	Trophy,
} from "lucide-react";
import Link from "next/link";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";

import { ThemeToggle } from "@/components/landing/theme-toggle";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useSessionStatus } from "@/hooks/useUser";
import { clearLastUsedProjectCookiesAction } from "@/lib/actions/project";
import { useAuth, useAuthClient } from "@/lib/auth-client";

import {
	revokeDeviceSession,
	setActiveDeviceSession,
	useDeviceAccounts,
	useRecordRecentLogin,
} from "@llmgateway/shared/accounts";
import { AccountSwitcher } from "@llmgateway/shared/components";

import type { User } from "@/lib/types";
import type { DeviceAccount } from "@llmgateway/shared/accounts";

const dashboardUrl =
	process.env.NODE_ENV === "development"
		? "http://localhost:3002/dashboard"
		: "https://llmgateway.io/dashboard";

interface SidebarUserMenuProps {
	user: User;
	/** The chat sidebar also links to the Lounge profile and leaderboard. */
	showLoungeLinks?: boolean;
}

export function SidebarUserMenu({
	user,
	showLoungeLinks = false,
}: SidebarUserMenuProps) {
	const posthog = usePostHog();
	const queryClient = useQueryClient();
	const { signOut } = useAuth();
	const authClient = useAuthClient();
	const { session } = useSessionStatus();
	const [open, setOpen] = useState(false);
	const [pendingUserId, setPendingUserId] = useState<string | null>(null);

	useRecordRecentLogin(user);

	// Only hit the device-sessions endpoint once the menu is actually opened.
	const { accounts, isLoading, refresh, forget } = useDeviceAccounts({
		client: authClient,
		activeUserId: user?.id,
		enabled: open,
	});

	// Only offer the bulk sign-out when more than one account actually has a
	// live session; remembered logins have nothing to sign out of.
	const liveSessionCount = accounts.filter(
		(account) => account.sessionToken,
	).length;

	const clearClientState = async () => {
		posthog.reset();
		try {
			await clearLastUsedProjectCookiesAction();
		} catch {
			// Non-fatal: the cookies are per-org hints, not auth state.
		}
	};

	// better-auth's /sign-out deletes every device session, so this is the
	// "leave all accounts" path.
	const logoutAll = async () => {
		await clearClientState();
		await signOut({
			fetchOptions: {
				onSuccess: () => {
					queryClient.clear();
					window.location.assign("/login");
				},
			},
		});
	};

	// Signs out only the active account; the revoke endpoint promotes the next
	// remaining device session instead of clearing every login on this device.
	const logout = async () => {
		const sessionToken = session?.session?.token;
		if (!sessionToken) {
			await logoutAll();
			return;
		}

		await clearClientState();
		const error = await revokeDeviceSession(authClient, sessionToken);
		if (error) {
			await logoutAll();
			return;
		}

		queryClient.clear();
		window.location.assign("/");
	};

	const handleSwitch = async (account: DeviceAccount) => {
		if (!account.sessionToken) {
			window.location.assign(
				`/login?add=1&email=${encodeURIComponent(account.email)}`,
			);
			return;
		}

		setPendingUserId(account.userId);
		const error = await setActiveDeviceSession(
			authClient,
			account.sessionToken,
		);
		if (error) {
			setPendingUserId(null);
			void refresh();
			return;
		}

		posthog.reset();
		// Hard navigation: chats, credits and org state are all fetched per user
		// and cached, so a client-side push would keep the previous account's data.
		window.location.assign("/");
	};

	if (!user) {
		return null;
	}

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu open={open} onOpenChange={setOpen}>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton
							size="lg"
							tooltip={user.name ?? "User"}
							className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
						>
							<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
								<span className="text-xs font-semibold">
									{user.name
										?.split(" ")
										.map((n: string) => n[0])
										.join("")
										.toUpperCase()
										.slice(0, 2) ?? "U"}
								</span>
							</div>
							<div className="grid flex-1 text-left text-sm leading-tight">
								<span className="truncate font-semibold">{user.name}</span>
								<span className="truncate text-xs text-muted-foreground">
									{user.email}
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
						<AccountSwitcher
							activeAccount={{
								userId: user.id,
								name: user.name,
								email: user.email,
							}}
							accounts={accounts}
							isLoading={isLoading}
							pendingUserId={pendingUserId}
							onSwitch={(account) => void handleSwitch(account)}
							onAddAccount={() => window.location.assign("/login?add=1")}
							onForget={forget}
						/>
						<DropdownMenuSeparator />
						{showLoungeLinks ? (
							<>
								<DropdownMenuItem asChild>
									<Link href="/profile" prefetch={true}>
										<Sparkles className="mr-2 h-4 w-4" />
										Profile &amp; Points
									</Link>
								</DropdownMenuItem>
								<DropdownMenuItem asChild>
									<Link href="/leaderboard" prefetch={true}>
										<Trophy className="mr-2 h-4 w-4" />
										Leaderboard
									</Link>
								</DropdownMenuItem>
							</>
						) : null}
						<DropdownMenuItem asChild>
							<Link href="/pricing" prefetch={true}>
								<CreditCard className="mr-2 h-4 w-4" />
								Membership &amp; Billing
							</Link>
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem asChild>
							<a href={dashboardUrl} target="_blank" rel="noopener noreferrer">
								<ExternalLink className="mr-2 h-4 w-4" />
								Dashboard
							</a>
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							className="justify-between gap-3"
							onSelect={(event) => event.preventDefault()}
						>
							<span>Theme</span>
							<div
								onClick={(event) => event.stopPropagation()}
								onKeyDown={(event) => event.stopPropagation()}
							>
								<ThemeToggle className="shrink-0" size="compact" />
							</div>
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={() => void logout()}>
							<LogOut className="mr-2 h-4 w-4" />
							Log out
						</DropdownMenuItem>
						{liveSessionCount > 1 ? (
							<DropdownMenuItem onClick={() => void logoutAll()}>
								<LogOut className="mr-2 h-4 w-4" />
								Log out of all accounts
							</DropdownMenuItem>
						) : null}
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
