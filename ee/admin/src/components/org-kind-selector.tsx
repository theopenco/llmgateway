"use client";

import { useSearchParams } from "next/navigation";

import { SegmentedUrlSelector } from "@/components/segmented-url-selector";
import { ORG_KIND_OPTIONS, parseOrgKind, type OrgKind } from "@/lib/org-kind";

/** Reads the current organization-kind view from the `kind` URL search param. */
export function useOrgKind(): OrgKind {
	const searchParams = useSearchParams();
	return parseOrgKind(searchParams.get("kind"));
}

/**
 * All / PAYG / DevPass / Chat toggle for global usage views, persisted in the
 * `kind` URL search param.
 */
export function OrgKindSelector({
	className,
	compact = false,
}: {
	className?: string;
	compact?: boolean;
} = {}) {
	return (
		<SegmentedUrlSelector
			param="kind"
			value={useOrgKind()}
			defaultValue="all"
			options={ORG_KIND_OPTIONS}
			className={className}
			compact={compact}
		/>
	);
}
