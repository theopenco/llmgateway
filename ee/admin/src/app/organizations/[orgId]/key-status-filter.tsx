"use client";

import { SegmentedUrlSelector } from "@/components/segmented-url-selector";
import {
	KEY_STATUS_DEFAULT,
	KEY_STATUS_OPTIONS,
	type KeyStatusFilter as KeyStatus,
} from "@/lib/key-status";

/**
 * Active / Disabled / Deleted / All toggle for a key list, persisted in a URL
 * search param. Selecting a status pins the tab it belongs to and resets that
 * list's page, since page N of the previous status is meaningless (and usually
 * empty) under the new one.
 */
export function KeyStatusFilter({
	param,
	tab,
	pageParam,
	value,
	counts,
}: {
	param: string;
	tab: string;
	pageParam?: string;
	value: KeyStatus;
	counts: Record<KeyStatus, number>;
}) {
	return (
		<div className="flex flex-wrap items-center gap-3">
			<SegmentedUrlSelector
				param={param}
				value={value}
				defaultValue={KEY_STATUS_DEFAULT}
				options={KEY_STATUS_OPTIONS.map((option) => ({
					...option,
					label: `${option.label} (${counts[option.value]})`,
				}))}
				extraParams={{ tab, ...(pageParam ? { [pageParam]: null } : {}) }}
				compact
			/>
		</div>
	);
}
