"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";

import { toast } from "@/lib/components/use-toast";

export function CopyMarkdownButton({ content }: { content: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(content);
		} catch {
			toast({
				title: "Could not copy Markdown",
				description: "Clipboard access is unavailable in this browser.",
				variant: "destructive",
			});
			return;
		}
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<button
			type="button"
			onClick={handleCopy}
			className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
		>
			{copied ? (
				<CheckIcon className="h-4 w-4 text-green-500" />
			) : (
				<CopyIcon className="h-4 w-4" />
			)}
			{copied ? "Copied!" : "Copy Markdown"}
		</button>
	);
}
