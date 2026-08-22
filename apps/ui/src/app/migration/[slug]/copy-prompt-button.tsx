"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";

export function CopyPromptButton({
	prompt,
	slug,
}: {
	prompt: string;
	slug: string;
}) {
	const posthog = usePostHog();
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(prompt);
		posthog.capture("migration_prompt_copied", { migration: slug });
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<button
			type="button"
			onClick={handleCopy}
			className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
		>
			{copied ? (
				<CheckIcon className="h-4 w-4" />
			) : (
				<CopyIcon className="h-4 w-4" />
			)}
			{copied ? "Copied!" : "Copy prompt"}
		</button>
	);
}
