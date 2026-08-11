"use client";

import { useEffect } from "react";

import { recordRecentLogin } from "./recent-logins.js";

export interface RecordableUser {
	id: string;
	name?: string | null;
	email: string;
	image?: string | null;
}

/**
 * Remembers the signed-in account on this device so it stays listed in the
 * profile switcher after its session expires or falls off the device-session
 * cap. Recording after the session exists (rather than at each sign-in call
 * site) covers email, passkey, social and SSO with one code path.
 */
export function useRecordRecentLogin(user: RecordableUser | null | undefined) {
	const userId = user?.id;
	const email = user?.email;
	const name = user?.name;
	const image = user?.image ?? null;

	useEffect(() => {
		if (!userId || !email) {
			return;
		}
		recordRecentLogin({ userId, email, name: name ?? email, image });
	}, [userId, email, name, image]);
}
