"use client";

import {
	FilterPendingSpinner,
	useFilterNavigation,
} from "@/components/filter-navigation";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const PENDING_KEY = "includeByok";

export function ByokErrorsToggle({ includeByok }: { includeByok: boolean }) {
	const { isPending, pendingKey, navigate } = useFilterNavigation();

	return (
		<div className="flex items-center gap-2">
			<Switch
				id="include-byok-errors"
				checked={includeByok}
				disabled={isPending}
				onCheckedChange={(checked) =>
					navigate(PENDING_KEY, (params) => {
						if (checked) {
							params.set("includeByok", "true");
						} else {
							params.delete("includeByok");
						}
					})
				}
			/>
			<Label
				htmlFor="include-byok-errors"
				className="flex items-center gap-1.5"
			>
				Bring your own key errors
				{pendingKey === PENDING_KEY && (
					<FilterPendingSpinner className="h-3.5 w-3.5" />
				)}
			</Label>
		</div>
	);
}
