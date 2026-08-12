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
 *
 * For the org's own keys the tooltip also names the exact key, so an attempt
 * can be tied back to a row on the provider-keys page. The gateway only ever
 * sends a label for BYOK attempts — LLM Gateway's own credentials are never
 * described — and this component never renders one for a `platform` source
 * even if a label were somehow present.
 */
export function CredentialSourceBadge({
	source,
	keyLabel,
	className,
}: {
	source: string | null | undefined;
	keyLabel?: string | null;
	className?: string;
}) {
	const credentialSource = toRoutingCredentialSource(source);
	if (!credentialSource) {
		return null;
	}

	const isByok = credentialSource === "byok";
	const Icon = isByok ? KeyRound : Building2;
	const describedKey = isByok && keyLabel ? keyLabel : null;

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
					{describedKey ?? ROUTING_CREDENTIAL_SOURCE_LABELS[credentialSource]}
				</span>
			</TooltipTrigger>
			<TooltipContent className="max-w-xs">
				{describedKey && (
					<p className="font-medium">Your key: {describedKey}</p>
				)}
				<p>{ROUTING_CREDENTIAL_SOURCE_DESCRIPTIONS[credentialSource]}</p>
			</TooltipContent>
		</Tooltip>
	);
}

export type { RoutingCredentialSource };
