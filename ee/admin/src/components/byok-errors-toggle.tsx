"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function ByokErrorsToggle({ includeByok }: { includeByok: boolean }) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const handleChange = useCallback(
		(checked: boolean) => {
			const params = new URLSearchParams(searchParams.toString());
			if (checked) {
				params.set("includeByok", "true");
			} else {
				params.delete("includeByok");
			}
			const queryString = params.toString();
			router.push(queryString ? `${pathname}?${queryString}` : pathname);
		},
		[pathname, router, searchParams],
	);

	return (
		<div className="flex items-center gap-2">
			<Switch
				id="include-byok-errors"
				checked={includeByok}
				onCheckedChange={handleChange}
			/>
			<Label htmlFor="include-byok-errors">Bring your own key errors</Label>
		</div>
	);
}
