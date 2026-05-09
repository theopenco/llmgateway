"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

export function CopyableId({
	id,
	className,
}: {
	id: string;
	className?: string;
}) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(id);
			setCopied(true);
			toast.success("ID copied");
			setTimeout(() => setCopied(false), 1500);
		} catch {
			toast.error("Failed to copy ID");
		}
	};

	return (
		<button
			type="button"
			onClick={handleCopy}
			title={id}
			className={cn(
				"group inline-flex items-center gap-1.5 rounded font-mono text-xs text-muted-foreground hover:text-foreground transition-colors",
				className,
			)}
		>
			<span className="max-w-[120px] truncate">{id}</span>
			{copied ? (
				<Check className="h-3 w-3 shrink-0 text-emerald-500" />
			) : (
				<Copy className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
			)}
		</button>
	);
}
