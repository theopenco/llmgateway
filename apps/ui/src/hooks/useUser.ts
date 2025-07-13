import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { usePostHog } from "posthog-js/react";
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
	checkOnboarding?: boolean;
	checkEmailVerification?: boolean;
}

export function useUser(options?: UseUserOptions) {
	const posthog = usePostHog();
	const navigate = useNavigate();
	const routerState = useRouterState();
	const api = useApi();

	const { data, isLoading, error } = api.useQuery("get", "/user/me", {
		retry: 0,
		gcTime: 0,
	});

	if (data) {
		posthog.identify(data.user.id, {
			email: data.user.email,
			name: data.user.name,
		});
	}

	// Check for onboarding completion for all authenticated users
	useEffect(() => {
		if (!data?.user || isLoading) {
			return;
		}

		const currentPath = routerState.location.pathname;
		const isAuthPage = ["/login", "/signup", "/onboarding"].includes(
			currentPath,
		);
		const isLandingPage = currentPath === "/";

		// Don't redirect if already on auth pages
		if (isAuthPage || isLandingPage) {
			return;
		}

		// Redirect to onboarding if user hasn't completed it
		if (!data.user.onboardingCompleted) {
			navigate({ to: "/onboarding", replace: true });
		}
	}, [data?.user, isLoading, navigate, routerState.location.pathname]);

	// Handle existing redirect logic
	useEffect(() => {
		if (!options?.redirectTo || !options?.redirectWhen) {
			return;
		}

		const { redirectTo, redirectWhen, checkOnboarding } = options;
		const hasUser = !!data?.user;

		if (redirectWhen === "authenticated" && hasUser) {
			if (
				checkOnboarding &&
				!data.user.onboardingCompleted &&
				routerState.location.pathname !== "/onboarding"
			) {
				navigate({ to: "/onboarding" });
			} else {
				navigate({ to: redirectTo });
			}
		} else if (
			redirectWhen === "unauthenticated" &&
			!isLoading &&
			(!hasUser || error)
		) {
			navigate({ to: redirectTo, replace: true });
		}
	}, [
		data,
		isLoading,
		error,
		navigate,
		options,
		routerState.location.pathname,
	]);

	return {
		user: data?.user || null,
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
			queryClient.invalidateQueries({ queryKey: ["user"] });
			queryClient.invalidateQueries({ queryKey: ["session"] });
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
