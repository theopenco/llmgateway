"use client";

import { ChevronRight, Loader2, X } from "lucide-react";

import { AccountAvatar } from "./account-switcher";

import type { DeviceAccount } from "@/accounts/use-device-accounts.js";

export interface AccountListProps {
	accounts: DeviceAccount[];
	pendingUserId?: string | null;
	onSelect: (account: DeviceAccount) => void;
	onForget?: (userId: string) => void;
	title?: string;
}

/**
 * Recently used accounts, shown above the sign-in form. Entries with a live
 * device session sign straight in; the rest just prefill the email field.
 */
export function AccountList({
	accounts,
	pendingUserId = null,
	onSelect,
	onForget,
	title = "Recent logins",
}: AccountListProps) {
	if (accounts.length === 0) {
		return null;
	}

	return (
		<div className="space-y-2">
			<p className="text-muted-foreground text-xs font-medium">{title}</p>
			<ul className="space-y-1.5">
				{accounts.map((account) => {
					const isPending = pendingUserId === account.userId;
					return (
						<li key={account.userId}>
							<div className="group border-input hover:bg-accent focus-within:ring-ring flex items-center gap-3 rounded-md border px-3 py-2 transition-colors focus-within:ring-1">
								<button
									type="button"
									disabled={isPending}
									onClick={() => onSelect(account)}
									className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none disabled:opacity-60"
								>
									<AccountAvatar
										name={account.name}
										email={account.email}
										image={account.image}
										className="size-8 rounded-lg"
									/>
									<span className="grid min-w-0 flex-1 leading-tight">
										<span className="truncate text-sm font-medium">
											{account.name}
										</span>
										<span className="text-muted-foreground truncate text-xs">
											{account.sessionToken
												? account.email
												: `${account.email} · sign in again`}
										</span>
									</span>
									{isPending ? (
										<Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
									) : (
										<ChevronRight className="text-muted-foreground size-4 shrink-0" />
									)}
								</button>
								{onForget && !isPending ? (
									<button
										type="button"
										aria-label={`Forget ${account.email}`}
										onClick={() => onForget(account.userId)}
										className="text-muted-foreground hover:text-foreground shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
									>
										<X className="size-3.5" />
									</button>
								) : null}
							</div>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
