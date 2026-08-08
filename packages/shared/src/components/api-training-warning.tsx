import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A provider that trains its models on the prompts sent through its API.
 *
 * Only an explicit `true` counts. `null`/`undefined` means the provider has not
 * published a data policy, which is *not* the same as "does not train" — those
 * providers are surfaced elsewhere (the Providers page, compliance policies)
 * rather than being quietly treated as safe here.
 */
export function trainsOnApiInputs(
	provider: { apiTraining?: boolean | null } | null | undefined,
): boolean {
	return provider?.apiTraining === true;
}

export const API_TRAINING_SHORT_LABEL = "Trains on your prompts";

export const API_TRAINING_DESCRIPTION =
	"This provider may use prompts sent through its API to train its models. Don't send personal or confidential data to it, and pick a different provider if your organization requires that prompts are never used for training.";

/**
 * Compact inline marker for dense lists (model picker rows), where a full
 * warning block would not fit. Carries an accessible label because the icon is
 * the only signal.
 */
export function ApiTrainingIcon({ className }: { className?: string }) {
	return (
		<AlertTriangle
			role="img"
			aria-label={API_TRAINING_SHORT_LABEL}
			className={cn(
				"h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500",
				className,
			)}
		/>
	);
}

/**
 * Full warning shown wherever there is room to explain — model detail panels,
 * preview cards. Renders nothing unless the provider explicitly trains on API
 * inputs, so callers can drop it in unconditionally.
 */
export function ApiTrainingWarning({
	provider,
	className,
}: {
	provider: { name?: string | null; apiTraining?: boolean | null } | null;
	className?: string;
}) {
	if (!trainsOnApiInputs(provider)) {
		return null;
	}

	return (
		<div
			className={cn(
				"flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs",
				className,
			)}
		>
			<AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-500" />
			<span className="text-foreground/80 leading-relaxed">
				<span className="font-medium">{API_TRAINING_SHORT_LABEL}.</span>{" "}
				{API_TRAINING_DESCRIPTION}
			</span>
		</div>
	);
}
