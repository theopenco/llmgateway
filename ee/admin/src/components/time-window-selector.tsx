"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import { pageWindowOptions } from "@/lib/page-window";

import type { PageWindow } from "@/lib/page-window";

export function TimeWindowSelector({ current }: { current: PageWindow }) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const handleSelect = useCallback(
		(w: PageWindow) => {
			const params = new URLSearchParams(searchParams.toString());
			params.set("window", w);
			params.delete("from");
			params.delete("to");
			params.delete("page");
			router.push(`${pathname}?${params.toString()}`);
		},
		[router, pathname, searchParams],
	);

	return (
		<div className="flex items-center gap-1">
			{pageWindowOptions.map((opt) => (
				<Button
					key={opt.value}
					variant={current === opt.value ? "default" : "outline"}
					size="sm"
					onClick={() => handleSelect(opt.value)}
				>
					{opt.label}
				</Button>
			))}
		</div>
	);
}
