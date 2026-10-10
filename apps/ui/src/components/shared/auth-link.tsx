"use client";

import Link from "next/link";

import { useSessionStatus } from "@/hooks/useUser";

import type { Route } from "next";

type AuthLinkProps = Omit<React.ComponentProps<typeof Link>, "to"> & {
	authenticatedHref?: Route;
	unauthenticatedHref?: Route;
};

export function AuthLink({
	authenticatedHref = "/dashboard",
	unauthenticatedHref = "/signup",
	...props
}: AuthLinkProps) {
	const { isAuthenticated, isLoading } = useSessionStatus();
	return (
		<Link
			{...props}
			href={
				isAuthenticated && !isLoading ? authenticatedHref : unauthenticatedHref
			}
			prefetch={true}
		/>
	);
}
