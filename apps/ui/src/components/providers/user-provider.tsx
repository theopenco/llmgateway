"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import { useApi } from "@/lib/fetch-client";

import type { User } from "@/lib/types";

interface UserProviderProps {
	children: React.ReactNode;
	initialUserData?: { user: User } | null;
}

export function UserProvider({ children, initialUserData }: UserProviderProps) {
	const queryClient = useQueryClient();
	const hasSetInitialData = useRef(false);
	const api = useApi();

	// Set initial data immediately when the component mounts
	// This ensures the data is available before any useUser hooks run
	if (initialUserData && !hasSetInitialData.current) {
		const queryKey = api.queryOptions("get", "/user/me", {}).queryKey;
		queryClient.setQueryData(queryKey, initialUserData);
		hasSetInitialData.current = true;
	}

	return children;
}
