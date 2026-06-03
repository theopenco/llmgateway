"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/lib/components/button";
import { Input } from "@/lib/components/input";

interface ReadonlyIdFieldProps {
	id: string;
	value: string;
	copyAriaLabel: string;
}

export function ReadonlyIdField({
	id,
	value,
	copyAriaLabel,
}: ReadonlyIdFieldProps) {
	const [copied, setCopied] = useState(false);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (err) {
			console.error("Failed to copy:", err);
		}
	};

	return (
		<div className="flex items-center gap-2 max-w-md">
			<Input id={id} type="text" value={value} readOnly className="font-mono" />
			<Button
				type="button"
				variant="outline"
				size="icon"
				onClick={copy}
				aria-label={copyAriaLabel}
			>
				{copied ? (
					<Check className="h-4 w-4 text-green-600" />
				) : (
					<Copy className="h-4 w-4" />
				)}
			</Button>
		</div>
	);
}
