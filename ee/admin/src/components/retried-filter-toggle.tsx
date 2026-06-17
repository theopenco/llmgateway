"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";

export function RetriedFilterToggle({
	includeRetried,
}: {
	includeRetried: boolean;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const handleSelect = useCallback(
		(value: boolean) => {
			const params = new URLSearchParams(searchParams.toString());
			if (value) {
				params.set("includeRetried", "true");
			} else {
				params.delete("includeRetried");
			}
			router.push(`${pathname}?${params.toString()}`);
		},
		[router, pathname, searchParams],
	);

	return (
		<div className="flex items-center gap-1">
			<Button
				variant={includeRetried ? "outline" : "default"}
				size="sm"
				onClick={() => handleSelect(false)}
			>
				Exclude retried
			</Button>
			<Button
				variant={includeRetried ? "default" : "outline"}
				size="sm"
				onClick={() => handleSelect(true)}
			>
				Include retried
			</Button>
		</div>
	);
}
