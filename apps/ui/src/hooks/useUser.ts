"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useEffect } from "react";

import { useAuthClient } from "@/lib/auth-client";
import { useApi } from "@/lib/fetch-client";

import type { Route } from "next";

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
	checkOnboarding?: boolean;
	enabled?: boolean;
}

/**
 * Lightweight session check for marketing/auth surfaces. Uses better-auth's
 * get-session endpoint, which returns 200 with null for anonymous visitors,
 * so it never logs a 401 console error like /user/me does.
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

	const { data, isLoading, error } = api.useQuery(
		"get",
		"/user/me",
		{},
		{
			retry: 0,
			staleTime: 5 * 60 * 1000, // 5 minutes
			refetchOnWindowFocus: false,
			enabled: options?.enabled ?? true,
		},
	);

	if (data) {
		posthog.identify(data.user.id, {
			email: data.user.email,
			name: data.user.name,
			onboarding_completed: data.user.onboardingCompleted,
		});
	}

	// Handle existing redirect logic
	useEffect(() => {
		if (!options?.redirectTo || !options?.redirectWhen) {
			return;
		}

		const { redirectTo, redirectWhen, checkOnboarding } = options;
		const hasUser = !!data?.user;

		if (redirectWhen === "authenticated" && hasUser && !isLoading && !error) {
			if (checkOnboarding && !data.user.onboardingCompleted) {
				router.push("/onboarding");
			} else {
				router.push(redirectTo as Route);
			}
		} else if (
			redirectWhen === "unauthenticated" &&
			!isLoading &&
			(!hasUser || error)
		) {
			router.push(redirectTo as Route);
		}
	}, [
		data?.user,
		isLoading,
		error,
		router,
		options?.redirectTo,
		options?.redirectWhen,
		options?.checkOnboarding,
		options,
	]);

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

export function useUpdatePassword() {
	const api = useApi();
	return api.useMutation("put", "/user/password");
}

export function useDeleteAccount() {
	const api = useApi();
	return api.useMutation("delete", "/user/me");
}
