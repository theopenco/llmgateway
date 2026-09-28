"use client";

import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { Tabs, TabsTrigger } from "@/components/ui/tabs";

import { buildOrganizationTabUrl } from "./organization-tab-url";

import type { ComponentProps } from "react";

export function OrganizationTabTrigger({
	value,
	...props
}: ComponentProps<typeof TabsTrigger>) {
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();
	const active = (searchParams.get("tab") ?? "transactions") === value;
	const href = buildOrganizationTabUrl(
		pathname,
		new URLSearchParams(searchParams),
		value,
	);

	useEffect(() => {
		if (!active) {
			// Dynamic tabs need their full server payload, not a partial prefetch.
			router.prefetch(href, { kind: PrefetchKind.FULL });
		}
	}, [active, href, router]);

	return <TabsTrigger {...props} value={value} />;
}

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
