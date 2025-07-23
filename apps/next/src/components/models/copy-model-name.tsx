"use client";

import { Copy, Check } from "lucide-react";
import { useState } from "react";

import { Button } from "@/lib/components/button";

interface CopyModelNameProps {
	modelName: string;
}

export function CopyModelName({ modelName }: CopyModelNameProps) {
	const [copied, setCopied] = useState(false);

	const copyToClipboard = async () => {
		try {
			await navigator.clipboard.writeText(modelName);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (err) {
			console.error("Failed to copy:", err);
		}
	};

	return (
		<div className="flex items-center gap-2">
			<code className="bg-muted px-2 py-1 rounded text-sm font-mono">
				{modelName}
			</code>
			<Button
				variant="ghost"
				size="sm"
				onClick={copyToClipboard}
				className="h-6 w-6 p-0"
			>
				{copied ? (
					<Check className="h-3 w-3 text-green-600" />
				) : (
					<Copy className="h-3 w-3" />
				)}
			</Button>
		</div>
	);
}
