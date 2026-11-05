"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
	MODEL_BREAKDOWNS,
	parseModelView,
	updateUsageBreakdown,
} from "@/lib/usage-breakdown";

import type { UsageBreakdownScope } from "@/lib/usage-breakdown";

export function UsageBreakdownSelector({
	scope,
}: {
	scope: UsageBreakdownScope;
}) {
	const params = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const group = params.get("breakdown");
	const dimension =
		group === "api-key" ||
		group === "user" ||
		(scope === "organization" && group === "project") ||
		(scope === "project" && group === "source")
			? group
			: parseModelView(params.get("modelView"));
	return (
		<label className="space-y-1.5">
			<span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
				Breakdown by
			</span>
			<select
				aria-label="Breakdown by"
				className="h-9 rounded-md border border-input bg-background px-3 text-xs"
				value={dimension}
				onChange={(event) => {
					const next = updateUsageBreakdown(
						new URLSearchParams(params.toString()),
						event.target.value,
					);
					const query = next.toString();
					router.replace(query ? `${pathname}?${query}` : pathname, {
						scroll: false,
					});
				}}
			>
				{MODEL_BREAKDOWNS.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
				{scope === "organization" ? (
					<option value="project">Projects</option>
				) : (
					<option value="source">Sources</option>
				)}
				<option value="api-key">API keys</option>
				<option value="user">Users</option>
			</select>
		</label>
	);
}
