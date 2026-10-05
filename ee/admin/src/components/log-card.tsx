"use client";

import { useCallback } from "react";

import { useFetchClient } from "@/lib/fetch-client";

import {
	LogCard as SharedLogCard,
	type LogCardData,
} from "@llmgateway/shared/components";

import type { ProjectLogEntry } from "@/lib/types";

export function LogCard({ log }: { log: ProjectLogEntry }) {
	const $fetch = useFetchClient();
	const fetchImageContent = useCallback(
		async (logId: string) => {
			const { data } = await $fetch.GET("/logs/{id}", {
				params: { path: { id: logId } },
			});
			return data?.log?.content ?? null;
		},
		[$fetch],
	);

	return (
		<SharedLogCard
			log={log as unknown as LogCardData}
			showCopyButtons
			showLogId
			fetchImageContent={fetchImageContent}
		/>
	);
}
