"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, LogOut } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useSessionStatus } from "@/hooks/useUser";
import { useAuth, useAuthClient } from "@/lib/auth-client";

import {
	revokeDeviceSession,
	setActiveDeviceSession,
	useDeviceAccounts,
	useRecordRecentLogin,
} from "@llmgateway/shared/accounts";
import {
	AccountAvatar,
	AccountSwitcher,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@llmgateway/shared/components";

import type { useUser } from "@/hooks/useUser";
import type { DeviceAccount } from "@llmgateway/shared/accounts";

type AccountUser = NonNullable<ReturnType<typeof useUser>["user"]>;

export function AccountMenu({ user }: { user: AccountUser | null }) {
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

	// better-auth's /sign-out deletes every device session, so this is the
	// "leave all accounts" path.
	const signOutAll = async () => {
		posthog.reset();
		await signOut({
			fetchOptions: {
				onSuccess: () => {
					queryClient.clear();
					window.location.assign("/");
				},
			},
		});
	};

	// Signs out only the active account; the revoke endpoint promotes the next
	// remaining device session instead of clearing every login on this device.
	const handleSignOut = async () => {
		const sessionToken = session?.session?.token;
		if (!sessionToken) {
			await signOutAll();
			return;
		}

		posthog.reset();
		const error = await revokeDeviceSession(authClient, sessionToken);
		if (error) {
			await signOutAll();
			return;
		}

		queryClient.clear();
		window.location.assign("/dashboard");
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
		// Hard navigation: the plan status and invoices are prefetched per user on
		// the server, so a client-side push would show the previous account's plan.
		window.location.assign("/dashboard");
	};

	if (!user) {
		return null;
	}

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="gap-2 text-muted-foreground"
				>
					<AccountAvatar
						name={user.name}
						email={user.email}
						className="size-6 rounded-md"
					/>
					<span className="hidden sm:block max-w-40 truncate text-sm">
						{user.email}
					</span>
					<ChevronDown className="h-3.5 w-3.5" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-60">
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
				<DropdownMenuItem onClick={() => void handleSignOut()}>
					<LogOut className="h-3.5 w-3.5" />
					<span>Sign out</span>
				</DropdownMenuItem>
				{accounts.length > 1 ? (
					<DropdownMenuItem onClick={() => void signOutAll()}>
						<LogOut className="h-3.5 w-3.5" />
						<span>Sign out of all accounts</span>
					</DropdownMenuItem>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
