"use client";

import Link from "next/link";
import { usePostHog } from "posthog-js/react";

import { AuthLink } from "@/components/shared/auth-link";

import type { Route } from "next";
import type { ReactNode } from "react";

interface TrackedLinkProps {
	href: string;
	location: string;
	cta: string;
	className?: string;
	children: ReactNode;
	auth?: boolean;
	external?: boolean;
}

export function TrackedLink({
	href,
	location,
	cta,
	className,
	children,
	auth,
	external,
}: TrackedLinkProps) {
	const posthog = usePostHog();
	const onClick = () => posthog.capture("cta_clicked", { location, cta });

	if (auth) {
		return (
			<AuthLink href={href as Route} className={className} onClick={onClick}>
				{children}
			</AuthLink>
		);
	}
	if (external) {
		return (
			<a
				href={href}
				target="_blank"
				rel="noopener noreferrer"
				className={className}
				onClick={onClick}
			>
				{children}
			</a>
		);
	}
	return (
		<Link href={href as Route} className={className} onClick={onClick}>
			{children}
		</Link>
	);
}
