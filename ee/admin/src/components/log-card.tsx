"use client";

import {
	LogCard as SharedLogCard,
	type LogCardData,
} from "@llmgateway/shared/components";

import type { ProjectLogEntry } from "@/lib/types";

export function LogCard({ log }: { log: ProjectLogEntry }) {
	return (
		<SharedLogCard
			log={log as unknown as LogCardData}
			showCopyButtons
			showLogId
		/>
	);
}
