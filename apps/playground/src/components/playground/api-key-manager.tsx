"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const LOCAL_KEY = "llmgateway_api_key";

export function ApiKeyManager({
	open,
	onOpenChange,
	onSaved,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSaved?: (key: string) => void;
}) {
	const [value, setValue] = useState("");

	useEffect(() => {
		if (open) {
			const stored =
				typeof window !== "undefined" ? localStorage.getItem(LOCAL_KEY) : null;
			setValue(stored || "");
		}
	}, [open]);

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
			<div className="w-[420px] rounded-md border bg-background p-4 shadow-md">
				<div className="text-sm font-medium mb-2">LLMGateway API Key</div>
				<input
					className="w-full rounded-md border px-3 py-2 text-sm mb-3 bg-background"
					placeholder="Enter your API key"
					value={value}
					onChange={(e) => setValue(e.currentTarget.value)}
				/>
				<div className="flex items-center justify-end gap-2">
					<Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						size="sm"
						onClick={() => {
							localStorage.setItem(LOCAL_KEY, value);
							onSaved?.(value);
							onOpenChange(false);
						}}
					>
						Save
					</Button>
				</div>
			</div>
		</div>
	);
}
