"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

interface ServerDataWrapperProps {
	children: React.ReactNode;
	initialData: Array<{
		queryKey: string[];
		data: any;
	}>;
}

export function ServerDataWrapper({
	children,
	initialData,
}: ServerDataWrapperProps) {
	const queryClient = useQueryClient();

	useEffect(() => {
		// Set initial data for all queries
		initialData.forEach(({ queryKey, data }) => {
			queryClient.setQueryData(queryKey, data);
		});
	}, [queryClient, initialData]);

	return children;
}
