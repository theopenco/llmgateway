"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	readRecentLogins,
	RECENT_LOGINS_CHANGED_EVENT,
	removeRecentLogin,
} from "./recent-logins.js";

export interface DeviceSession {
	session: { token: string };
	user: { id: string; name: string; email: string; image?: string | null };
}

/**
 * Structural subset of better-auth's `multiSessionClient()` surface. Declared
 * here so this package doesn't need a better-auth dependency — each app passes
 * in its own `useAuthClient()` instance.
 */
export interface DeviceSessionClient {
	multiSession: {
		listDeviceSessions: () => Promise<{ data?: DeviceSession[] | null }>;
		setActive: (input: {
			sessionToken: string;
		}) => Promise<{ error?: { message?: string } | null }>;
		revoke: (input: {
			sessionToken: string;
		}) => Promise<{ error?: { message?: string } | null }>;
	};
}

export interface DeviceAccount {
	userId: string;
	name: string;
	email: string;
	image?: string | null;
	/** `null` when only a remembered login exists, so switching needs a sign-in. */
	sessionToken: string | null;
	isActive: boolean;
}

export interface UseDeviceAccountsOptions {
	client: DeviceSessionClient;
	activeUserId?: string | null;
	/** Defer the request until the menu is actually opened. */
	enabled?: boolean;
}

export function useDeviceAccounts({
	client,
	activeUserId,
	enabled = true,
}: UseDeviceAccountsOptions) {
	const [sessions, setSessions] = useState<DeviceSession[]>([]);
	const [recent, setRecent] = useState(() => readRecentLogins());
	const [isLoading, setIsLoading] = useState(false);
	const [hasLoaded, setHasLoaded] = useState(false);
	const clientRef = useRef(client);
	clientRef.current = client;

	const refresh = useCallback(async () => {
		setIsLoading(true);
		try {
			const { data } =
				await clientRef.current.multiSession.listDeviceSessions();
			setSessions(data ?? []);
		} catch {
			// Offline or a rejected request: fall back to remembered logins only.
			setSessions([]);
		} finally {
			setIsLoading(false);
			setHasLoaded(true);
		}
	}, []);

	useEffect(() => {
		if (!enabled || hasLoaded) {
			return;
		}
		void refresh();
	}, [enabled, hasLoaded, refresh]);

	useEffect(() => {
		const sync = () => setRecent(readRecentLogins());
		sync();
		window.addEventListener("storage", sync);
		window.addEventListener(RECENT_LOGINS_CHANGED_EVENT, sync);
		return () => {
			window.removeEventListener("storage", sync);
			window.removeEventListener(RECENT_LOGINS_CHANGED_EVENT, sync);
		};
	}, []);

	const accounts = useMemo<DeviceAccount[]>(() => {
		const live = sessions.map((entry) => ({
			userId: entry.user.id,
			name: entry.user.name,
			email: entry.user.email,
			image: entry.user.image ?? null,
			sessionToken: entry.session.token,
			isActive: entry.user.id === activeUserId,
		}));
		const liveUserIds = new Set(live.map((account) => account.userId));
		const remembered = recent
			.filter((entry) => !liveUserIds.has(entry.userId))
			.map((entry) => ({
				userId: entry.userId,
				name: entry.name,
				email: entry.email,
				image: entry.image ?? null,
				sessionToken: null,
				isActive: false,
			}));
		return [...live, ...remembered].sort((a, b) =>
			a.isActive === b.isActive ? 0 : a.isActive ? -1 : 1,
		);
	}, [sessions, recent, activeUserId]);

	const forget = useCallback((userId: string) => {
		setRecent(removeRecentLogin(userId));
		setSessions((current) =>
			current.filter((entry) => entry.user.id !== userId),
		);
	}, []);

	return { accounts, isLoading, hasLoaded, refresh, forget };
}

export async function setActiveDeviceSession(
	client: DeviceSessionClient,
	sessionToken: string,
): Promise<string | null> {
	const { error } = await client.multiSession.setActive({ sessionToken });
	return error ? (error.message ?? "Failed to switch account") : null;
}

export async function revokeDeviceSession(
	client: DeviceSessionClient,
	sessionToken: string,
): Promise<string | null> {
	const { error } = await client.multiSession.revoke({ sessionToken });
	return error ? (error.message ?? "Failed to sign out") : null;
}
