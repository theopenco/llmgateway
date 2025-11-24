"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { useAppConfig } from "@/lib/config";

export function ReferralHandler() {
	const searchParams = useSearchParams();
	const { apiUrl } = useAppConfig();

	useEffect(() => {
		const ref = searchParams.get("ref");
		if (ref) {
			fetch(`${apiUrl}/referral`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				credentials: "include",
				body: JSON.stringify({ ref }),
			}).catch(() => {
				// Silently fail - referral tracking is not critical
			});
		}
	}, [searchParams, apiUrl]);

	return null;
}
