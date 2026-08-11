"use client";

import { Check, Loader2, UserPlus, X } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import {
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
} from "./ui/dropdown-menu";

import type { DeviceAccount } from "@/accounts/use-device-accounts.js";

export function getAccountInitials(
	name?: string | null,
	email?: string | null,
) {
	const source = name?.trim() || email?.trim();
	if (!source) {
		return "U";
	}
	return source
		.split(/[\s@._-]+/)
		.filter(Boolean)
		.map((part) => part[0])
		.join("")
		.toUpperCase()
		.slice(0, 2);
}

export function AccountAvatar({
	name,
	email,
	image,
	className,
}: {
	name?: string | null;
	email?: string | null;
	image?: string | null;
	className?: string;
}) {
	return (
		<Avatar className={className ?? "size-7 rounded-lg"}>
			{image ? (
				<AvatarImage src={image} alt={name ?? email ?? "Account"} />
			) : null}
			<AvatarFallback className="rounded-lg text-[10px] font-semibold">
				{getAccountInitials(name, email)}
			</AvatarFallback>
		</Avatar>
	);
}

export interface AccountSwitcherProps {
	activeAccount: {
		userId: string;
		name?: string | null;
		email?: string | null;
		image?: string | null;
	} | null;
	accounts: DeviceAccount[];
	isLoading?: boolean;
	/** Account currently being switched to, so its row can show a spinner. */
	pendingUserId?: string | null;
	onSwitch: (account: DeviceAccount) => void;
	onAddAccount: () => void;
	onForget?: (userId: string) => void;
}

export function AccountSwitcher({
	activeAccount,
	accounts,
	isLoading = false,
	pendingUserId = null,
	onSwitch,
	onAddAccount,
	onForget,
}: AccountSwitcherProps) {
	const others = accounts.filter(
		(account) => account.userId !== activeAccount?.userId,
	);

	return (
		<>
			{activeAccount ? (
				<>
					<DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
						Signed in as
					</DropdownMenuLabel>
					<div className="flex items-center gap-2 px-2 pb-1.5">
						<AccountAvatar
							name={activeAccount.name}
							email={activeAccount.email}
							image={activeAccount.image}
						/>
						<div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
							<span className="truncate font-semibold">
								{activeAccount.name}
							</span>
							<span className="text-muted-foreground truncate text-xs">
								{activeAccount.email}
							</span>
						</div>
						<Check className="size-4 shrink-0" />
					</div>
				</>
			) : null}

			{others.length > 0 ? (
				<>
					<DropdownMenuSeparator />
					<DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
						Switch account
					</DropdownMenuLabel>
					{others.map((account) => {
						const isPending = pendingUserId === account.userId;
						return (
							<DropdownMenuItem
								key={account.userId}
								className="group gap-2"
								disabled={isPending}
								onSelect={(event) => {
									event.preventDefault();
									onSwitch(account);
								}}
							>
								<AccountAvatar
									name={account.name}
									email={account.email}
									image={account.image}
								/>
								<div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
									<span className="truncate">{account.name}</span>
									<span className="text-muted-foreground truncate text-xs">
										{account.sessionToken ? account.email : "Sign in again"}
									</span>
								</div>
								{isPending ? (
									<Loader2 className="size-4 shrink-0 animate-spin" />
								) : onForget ? (
									<button
										type="button"
										aria-label={`Forget ${account.email}`}
										className="text-muted-foreground hover:text-foreground shrink-0 opacity-0 transition-opacity group-focus:opacity-100 group-hover:opacity-100"
										onClick={(event) => {
											event.preventDefault();
											event.stopPropagation();
											onForget(account.userId);
										}}
									>
										<X className="size-3.5" />
									</button>
								) : null}
							</DropdownMenuItem>
						);
					})}
				</>
			) : null}

			<DropdownMenuItem
				className="gap-2"
				onSelect={(event) => {
					event.preventDefault();
					onAddAccount();
				}}
			>
				{isLoading && others.length === 0 ? (
					<Loader2 className="size-4 animate-spin" />
				) : (
					<UserPlus className="size-4" />
				)}
				<span>Add another account</span>
			</DropdownMenuItem>
		</>
	);
}
