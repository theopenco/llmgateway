"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
	const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (resetTimerRef.current !== null) {
				clearTimeout(resetTimerRef.current);
			}
		};
	}, []);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(id);
			setCopied(true);
			toast.success("ID copied");
			if (resetTimerRef.current !== null) {
				clearTimeout(resetTimerRef.current);
			}
			resetTimerRef.current = setTimeout(() => {
				resetTimerRef.current = null;
				setCopied(false);
			}, 1500);
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
