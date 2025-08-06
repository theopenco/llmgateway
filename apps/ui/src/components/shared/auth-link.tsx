"use client";

import Link from "next/link";

import { useUser } from "@/hooks/useUser";

type AuthLinkProps = Omit<React.ComponentProps<typeof Link>, "to">;

export function AuthLink(props: AuthLinkProps) {
	const { user, isLoading } = useUser();
	return (
		<Link
			{...props}
			href={user && !isLoading ? "/dashboard" : "/signup"}
			prefetch={true}
		/>
	);
}
