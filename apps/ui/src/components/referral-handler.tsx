"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

const REFERRAL_COOKIE_NAME = "llmgateway_referral";
const REFERRAL_COOKIE_DAYS = 30;

export function ReferralHandler() {
	const searchParams = useSearchParams();

	useEffect(() => {
		const ref = searchParams.get("ref");
		if (ref) {
			const expires = new Date();
			expires.setDate(expires.getDate() + REFERRAL_COOKIE_DAYS);
			document.cookie = `${REFERRAL_COOKIE_NAME}=${encodeURIComponent(ref)}; path=/; expires=${expires.toUTCString()}; SameSite=Lax`;
		}
	}, [searchParams]);

	return null;
}
