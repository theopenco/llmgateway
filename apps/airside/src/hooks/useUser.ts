"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useApi } from "@/lib/fetch-client";

import type { paths } from "@/lib/api/v1";

export type UserMe =
	paths["/user/me"]["get"]["responses"]["200"]["content"]["application/json"];

export interface UseUserOptions {
	redirectTo?: string;
	redirectWhen?: "authenticated" | "unauthenticated";
	initialData?: UserMe | null;
}

export function useUser(options?: UseUserOptions) {
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
			staleTime: 5 * 60 * 1000,
			refetchOnWindowFocus: false,
			initialData: options?.initialData ?? undefined,
		},
	);

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
