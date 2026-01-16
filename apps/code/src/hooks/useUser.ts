"use client";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useEffect } from "react";

import { useApi } from "@/lib/fetch-client";

export interface UseUserOptions {
	redirectTo?: string;
	redirectWhen?: "authenticated" | "unauthenticated";
}

export function useUser(options?: UseUserOptions) {
	const posthog = usePostHog();
	const router = useRouter();
	const api = useApi();
	const pathname = usePathname();

	const { data, isLoading, error } = api.useQuery(
		"get",
		"/user/me",
		{},
		{
			retry: 0,
			staleTime: 5 * 60 * 1000,
			refetchOnWindowFocus: false,
		},
	);

	if (data) {
		posthog.identify(data.user.id, {
			email: data.user.email,
			name: data.user.name,
		});
	}

	useEffect(() => {
		if (!data?.user || isLoading) {
			return;
		}

		const currentPath = pathname;
		const isAuthPage = ["/login", "/signup"].includes(currentPath);
		const isLandingPage = currentPath === "/";

		if (isAuthPage || isLandingPage) {
			return;
		}
	}, [data?.user, isLoading, router, pathname]);

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
			void queryClient.invalidateQueries({ queryKey: ["user"] });
			void queryClient.invalidateQueries({ queryKey: ["session"] });
		},
	});
}
