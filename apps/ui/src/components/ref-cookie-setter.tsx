"use client";

import { useEffect } from "react";

import { useFetchClient } from "@/lib/fetch-client";

export function RefCookieSetter({ orgId }: { orgId: string }) {
	const fetchClient = useFetchClient();

	useEffect(() => {
		fetchClient.POST("/referral", { body: { ref: orgId } }).catch(() => {
			// Silently fail - referral tracking is not critical
		});
	}, [fetchClient, orgId]);

	return null;
}
