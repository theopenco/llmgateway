"use client";

import Link from "next/link";

import { useSessionStatus } from "@/hooks/useUser";

type AuthLinkProps = Omit<React.ComponentProps<typeof Link>, "to">;

export function AuthLink(props: AuthLinkProps) {
	const { isAuthenticated, isLoading } = useSessionStatus();
	return (
		<Link
			{...props}
			href={isAuthenticated && !isLoading ? "/dashboard" : "/signup"}
			prefetch={true}
		/>
	);
}
