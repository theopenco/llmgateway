"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useCallback } from "react";

import { clearLastUsedProjectCookiesAction } from "@/lib/actions/project";
import { useAuth } from "@/lib/auth-client";

const LOGIN_URL =
	process.env.NODE_ENV === "development"
		? "http://localhost:3003/login"
		: "https://lounge.llmgateway.io/login";

export function useLogout() {
	const router = useRouter();
	const posthog = usePostHog();
	const queryClient = useQueryClient();
	const { signOut } = useAuth();

	return useCallback(async () => {
		posthog.reset();
		await clearLastUsedProjectCookiesAction().catch(() => undefined);
		await signOut({
			fetchOptions: {
				onSuccess: () => {
					queryClient.clear();
					router.push(LOGIN_URL);
				},
			},
		});
	}, [posthog, queryClient, router, signOut]);
}
