"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";

export type UnstableWindow = "4h" | "24h" | "3d" | "7d";

const WINDOW_OPTIONS: { value: UnstableWindow; label: string }[] = [
	{ value: "4h", label: "4h" },
	{ value: "24h", label: "24h" },
	{ value: "3d", label: "3d" },
	{ value: "7d", label: "7d" },
];

export function UnstableWindowToggle({ window }: { window: UnstableWindow }) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const handleSelect = useCallback(
		(value: UnstableWindow) => {
			const params = new URLSearchParams(searchParams.toString());
			if (value === "24h") {
				params.delete("window");
			} else {
				params.set("window", value);
			}
			router.push(`${pathname}?${params.toString()}`);
		},
		[router, pathname, searchParams],
	);

	return (
		<div className="flex items-center gap-1">
			{WINDOW_OPTIONS.map((option) => (
				<Button
					key={option.value}
					variant={window === option.value ? "default" : "outline"}
					size="sm"
					onClick={() => handleSelect(option.value)}
				>
					{option.label}
				</Button>
			))}
		</div>
	);
}
