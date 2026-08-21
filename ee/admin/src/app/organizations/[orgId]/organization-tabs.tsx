"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Tabs } from "@/components/ui/tabs";

import { buildOrganizationTabUrl } from "./organization-tab-url";

import type { ComponentProps } from "react";

export function OrganizationTabs({
	defaultValue,
	...props
}: ComponentProps<typeof Tabs>) {
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();

	return (
		<Tabs
			{...props}
			value={defaultValue}
			onValueChange={(value) => {
				if ((searchParams.get("tab") ?? "transactions") === value) {
					return;
				}
				router.push(
					buildOrganizationTabUrl(
						pathname,
						new URLSearchParams(searchParams),
						value,
					),
					{ scroll: false },
				);
			}}
		/>
	);
}
