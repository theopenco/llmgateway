"use client";

import { useEffect } from "react";

import { useAppConfig } from "@/lib/config";

export function RefCookieSetter({ orgId }: { orgId: string }) {
	const { apiUrl } = useAppConfig();

	useEffect(() => {
		fetch(`${apiUrl}/referral`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			credentials: "include",
			body: JSON.stringify({ ref: orgId }),
		}).catch(() => {
			// Silently fail - referral tracking is not critical
		});
	}, [apiUrl, orgId]);

	return null;
}
