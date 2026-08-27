"use client";

import Link from "next/link";
import { usePostHog } from "posthog-js/react";

import type { ComponentProps } from "react";

// Thin client boundary for PostHog click tracking, so purely presentational
// cards can stay server components instead of shipping their whole markup as
// client JS.
export function TrackedLink({
	event,
	properties,
	onClick,
	...props
}: ComponentProps<typeof Link> & {
	event: string;
	properties?: Record<string, string>;
}) {
	const posthog = usePostHog();

	return (
		<Link
			{...props}
			onClick={(clickEvent) => {
				onClick?.(clickEvent);
				posthog.capture(event, properties);
			}}
		/>
	);
}
