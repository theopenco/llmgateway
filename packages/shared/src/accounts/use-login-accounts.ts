"use client";

import { useCallback, useState } from "react";

import {
	setActiveDeviceSession,
	useDeviceAccounts,
} from "./use-device-accounts.js";

import type {
	DeviceAccount,
	DeviceSessionClient,
} from "./use-device-accounts.js";

export interface UseLoginAccountsOptions {
	client: DeviceSessionClient;
	/** Called for accounts without a live session, to prefill the sign-in form. */
	onPrefillEmail: (email: string) => void;
	redirectTo: string;
	/** Hide the account already signed in on this tab (the "add account" flow). */
	excludeUserId?: string | null;
}

/**
 * Drives the recent-accounts list on a sign-in page. Accounts with a live
 * device session sign straight back in; the rest fall back to prefilling the
 * form so the user only has to type a password.
 */
export function useLoginAccounts({
	client,
	onPrefillEmail,
	redirectTo,
	excludeUserId,
}: UseLoginAccountsOptions) {
	const { accounts, isLoading, refresh, forget } = useDeviceAccounts({
		client,
	});
	const [pendingUserId, setPendingUserId] = useState<string | null>(null);

	const selectAccount = useCallback(
		async (account: DeviceAccount) => {
			if (!account.sessionToken) {
				onPrefillEmail(account.email);
				return;
			}

			setPendingUserId(account.userId);
			const error = await setActiveDeviceSession(client, account.sessionToken);
			if (error) {
				setPendingUserId(null);
				onPrefillEmail(account.email);
				void refresh();
				return;
			}

			window.location.assign(redirectTo);
		},
		[client, onPrefillEmail, redirectTo, refresh],
	);

	return {
		accounts: excludeUserId
			? accounts.filter((account) => account.userId !== excludeUserId)
			: accounts,
		isLoading,
		pendingUserId,
		selectAccount,
		forget,
	};
}
