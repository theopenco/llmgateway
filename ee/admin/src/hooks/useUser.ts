"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useApi } from "@/lib/fetch-client";

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
	const router = useRouter();
	const api = useApi();

	const { data, isLoading, error, errorUpdatedAt } = api.useQuery(
		"get",
		"/user/me",
		{},
		{
			retry: 0,
			staleTime: 5 * 60 * 1000, // 5 minutes
			refetchOnWindowFocus: false,
		},
	);

	// Handle existing redirect logic
	useEffect(() => {
		if (!options?.redirectTo || !options?.redirectWhen) {
			return;
		}

		const { redirectTo, redirectWhen } = options;
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
	}, [
		data?.user,
		isLoading,
		error,
		router,
		options?.redirectTo,
		options?.redirectWhen,
		options,
	]);

	return {
		user: data?.user ?? null,
		isLoading,
		error,
		/** Whether `/user/me` has ever rejected the session; survives refetches. */
		sessionRejected: errorUpdatedAt > 0,
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

export function useUpdatePassword() {
	const api = useApi();
	return api.useMutation("put", "/user/password");
}

export function useDeleteAccount() {
	const api = useApi();
	return api.useMutation("delete", "/user/me");
}
