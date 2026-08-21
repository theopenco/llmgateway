"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Tabs } from "@/components/ui/tabs";

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
			defaultValue={defaultValue}
			onValueChange={(value) => {
				if (value !== "settings" || searchParams.get("tab") === "settings") {
					return;
				}
				const nextSearchParams = new URLSearchParams(searchParams);
				nextSearchParams.set("tab", "settings");
				router.push(`${pathname}?${nextSearchParams.toString()}`);
			}}
		/>
	);
}
