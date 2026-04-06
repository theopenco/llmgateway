"use client";

import Link from "next/link";

import {
	LogCard as SharedLogCard,
	type LogCardData,
} from "@llmgateway/shared/components";

import type { Log } from "@llmgateway/db";

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
	log: Partial<Log>;
	orgId?: string;
	projectId?: string;
}) {
	const getDetailUrl =
		orgId && projectId && log.id
			? (logId: string) => `/dashboard/${orgId}/${projectId}/activity/${logId}`
			: undefined;

	const getRetriedUrl =
		orgId && projectId
			? (logId: string) => `/dashboard/${orgId}/${projectId}/activity/${logId}`
			: undefined;

	return (
		<SharedLogCard
			log={log as LogCardData}
			getDetailUrl={getDetailUrl}
			getRetriedUrl={getRetriedUrl}
			renderLink={NextLink}
			isUserFacing
		/>
	);
}
