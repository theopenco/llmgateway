"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useEffect } from "react";

import { useApi } from "@/lib/fetch-client";
import { clearPendingIdentity, identifyUser } from "@/lib/posthog-identity";

export interface UserUpdateData {
	name?: string;
	email?: string;
}

export interface PasswordUpdateData {
	currentPassword: string;
	newPassword: string;
}

export interface UseUserOptions {
	redirectTo?: string;
	redirectWhen?: "authenticated" | "unauthenticated";
}

export function useUser(options?: UseUserOptions) {
	const posthog = usePostHog();
	const router = useRouter();
	const api = useApi();
	const redirectTo = options?.redirectTo;
	const redirectWhen = options?.redirectWhen;

	const { data, isLoading, error } = api.useQuery(
		"get",
		"/user/me",
		{},
		{
			retry: 0,
			staleTime: 5 * 60 * 1000, // 5 minutes
			refetchOnWindowFocus: false,
		},
	);

	useEffect(() => {
		if (data?.user) {
			// Queued rather than called directly: this effect fires once and can
			// win the race against the deferred posthog.init(), which would drop
			// the identify() and leave the whole session anonymous.
			identifyUser(posthog, data.user.id, {
				email: data.user.email,
				name: data.user.name,
			});
		} else {
			clearPendingIdentity();
		}
	}, [data?.user, posthog]);

	// Handle existing redirect logic
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
			void queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/user/me").queryKey,
			});
		},
	});
}

export function useUpdatePassword() {
	const api = useApi();
	return api.useMutation("put", "/user/password");
}

export function useDeleteAccount() {
	const api = useApi();
	return api.useMutation("delete", "/user/me");
}
