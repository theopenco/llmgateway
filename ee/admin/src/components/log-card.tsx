"use client";

import { useCallback } from "react";

import { getLogContent } from "@/lib/admin-organizations";

import {
	LogCard as SharedLogCard,
	type LogCardData,
} from "@llmgateway/shared/components";

import type { ProjectLogEntry } from "@/lib/types";

export function LogCard({ log }: { log: ProjectLogEntry }) {
	const fetchImageContent = useCallback(async (logId: string) => {
		return await getLogContent(logId);
	}, []);

	return (
		<SharedLogCard
			log={log as unknown as LogCardData}
			showCopyButtons
			showLogId
			fetchImageContent={fetchImageContent}
		/>
	);
}
