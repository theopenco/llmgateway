"use client";

import Link from "next/link";
import { useCallback } from "react";

import { useFetchClient } from "@/lib/fetch-client";

import {
	LogCard as SharedLogCard,
	type LogCardData,
} from "@llmgateway/shared/components";

import type { Log } from "@llmgateway/db";

type DashboardLog = Partial<Log> & {
	organizationName?: string | null;
	projectName?: string | null;
	apiKeyName?: string | null;
};

function NextLink({
	href,
	className,
	children,
}: {
	href: string;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<Link href={href} className={className} prefetch={false}>
			{children}
		</Link>
	);
}

export function LogCard({
	log,
	orgId,
	projectId,
}: {
	log: DashboardLog;
	orgId?: string;
	projectId?: string;
}) {
	const fetchClient = useFetchClient();

	const getDetailUrl =
		orgId && projectId && log.id
			? (logId: string) => `/dashboard/${orgId}/${projectId}/activity/${logId}`
			: undefined;

	const getRetriedUrl =
		orgId && projectId
			? (logId: string) => `/dashboard/${orgId}/${projectId}/activity/${logId}`
			: undefined;

	const fetchImageContent = useCallback(
		async (logId: string) => {
			const { data } = await fetchClient.GET("/logs/{id}", {
				params: { path: { id: logId } },
			});
			return data?.log?.content ?? null;
		},
		[fetchClient],
	);

	const fetchInputImages = useCallback(
		async (logId: string) => {
			const { data } = await fetchClient.GET("/logs/{id}", {
				params: { path: { id: logId } },
			});
			const messages = data?.log?.messages;
			if (!messages) {
				return null;
			}
			const haystack = JSON.stringify(messages);
			const dataUrlRegex =
				/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;
			const matches = haystack.match(dataUrlRegex);
			return matches && matches.length > 0 ? matches : null;
		},
		[fetchClient],
	);

	return (
		<SharedLogCard
			log={log as LogCardData}
			getDetailUrl={getDetailUrl}
			getRetriedUrl={getRetriedUrl}
			renderLink={NextLink}
			showCopyButtons
			isUserFacing
			fetchImageContent={fetchImageContent}
			fetchInputImages={fetchInputImages}
		/>
	);
}
