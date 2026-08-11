"use client";

import { Building2, KeyRound } from "lucide-react";

import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
	ROUTING_CREDENTIAL_SOURCE_DESCRIPTIONS,
	ROUTING_CREDENTIAL_SOURCE_LABELS,
	type RoutingCredentialSource,
	toRoutingCredentialSource,
} from "@/routing-telemetry.js";

/**
 * Says whose provider credential served an attempt: the organization's own key
 * or LLM Gateway's. Without it the routing view shows two indistinguishable key
 * fingerprints for a request that fell back from BYOK to credits.
 */
export function CredentialSourceBadge({
	source,
	className,
}: {
	source: string | null | undefined;
	className?: string;
}) {
	const credentialSource = toRoutingCredentialSource(source);
	if (!credentialSource) {
		return null;
	}

	const isByok = credentialSource === "byok";
	const Icon = isByok ? KeyRound : Building2;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					className={cn(
						"inline-flex items-center gap-1 rounded border px-1 py-px text-[10px] font-medium leading-4 whitespace-nowrap",
						isByok
							? "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400"
							: "border-sky-300 text-sky-700 dark:border-sky-800 dark:text-sky-400",
						className,
					)}
				>
					<Icon className="h-2.5 w-2.5" />
					{ROUTING_CREDENTIAL_SOURCE_LABELS[credentialSource]}
				</span>
			</TooltipTrigger>
			<TooltipContent className="max-w-xs">
				<p>{ROUTING_CREDENTIAL_SOURCE_DESCRIPTIONS[credentialSource]}</p>
			</TooltipContent>
		</Tooltip>
	);
}

export type { RoutingCredentialSource };
