"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useEffect } from "react";

import { useAuthClient } from "@/lib/auth-client";
import { useAppConfig } from "@/lib/config";
import { useApi } from "@/lib/fetch-client";

import type { paths } from "@/lib/api/v1";

export type UserMe =
	paths["/user/me"]["get"]["responses"]["200"]["content"]["application/json"];

export interface UseUserOptions {
	redirectTo?: string;
	redirectWhen?: "authenticated" | "unauthenticated";
	initialData?: UserMe | null;
}

/**
 * Lightweight session check backed by better-auth's get-session endpoint. Used
 * where the session token itself is needed (per-account sign-out), which
 * `/user/me` does not expose.
 */
export function useSessionStatus() {
	const authClient = useAuthClient();

	const { data, isLoading } = useQuery({
		queryKey: ["auth-session-status"],
		queryFn: async () => {
			const { data: session } = await authClient.getSession();
			return session ?? null;
		},
		retry: 0,
		staleTime: 60 * 1000,
		refetchOnWindowFocus: false,
	});

	return {
		isAuthenticated: !!data?.user,
		isLoading,
		session: data ?? null,
	};
}

export function useUser(options?: UseUserOptions) {
	const posthog = usePostHog();
	const router = useRouter();
	const api = useApi();
	const { posthogKey } = useAppConfig();
	const redirectTo = options?.redirectTo;
	const redirectWhen = options?.redirectWhen;

	const { data, isLoading, error } = api.useQuery(
		"get",
		"/user/me",
		{},
		{
			retry: 0,
			staleTime: 5 * 60 * 1000,
			refetchOnWindowFocus: false,
			initialData: options?.initialData ?? undefined,
		},
	);

	useEffect(() => {
		if (!data?.user || !posthogKey) {
			return;
		}

		posthog.identify(data.user.id, {
			email: data.user.email,
			name: data.user.name,
		});
	}, [data?.user, posthog, posthogKey]);

	useEffect(() => {
		if (!redirectTo || !redirectWhen) {
			return;
		}

		const hasUser = !!data?.user;

		if (redirectWhen === "authenticated" && hasUser) {
			router.push(redirectTo);
		} else if (
			redirectWhen === "unauthenticated" &&
			!isLoading &&
			(!hasUser || error)
		) {
			router.push(redirectTo);
		}
	}, [data?.user, isLoading, error, router, redirectTo, redirectWhen]);

	return {
		user: data?.user ?? null,
		isLoading,
		error,
		data,
	};
}

export function useUpdateUser() {
	const queryClient = useQueryClient();
	const api = useApi();

	return api.useMutation("patch", "/user/me", {
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["user"] });
			void queryClient.invalidateQueries({ queryKey: ["session"] });
		},
	});
}

export function useDeleteAccount() {
	const api = useApi();
	return api.useMutation("delete", "/user/me");
}

/**
 * What deleting the account will tear down: the organizations the user is the
 * last member of, and the Stripe subscriptions those organizations still hold.
 * Fetched so the confirmation dialog can name them instead of cancelling the
 * DevPass subscription silently.
 */
export function useAccountDeletionPreview(enabled = true) {
	const api = useApi();
	return api.useQuery(
		"get",
		"/user/me/deletion-preview",
		{},
		{
			enabled,
			staleTime: 60 * 1000,
			refetchOnWindowFocus: false,
		},
	);
}
