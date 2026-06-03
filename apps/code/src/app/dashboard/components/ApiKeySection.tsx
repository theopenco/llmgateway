"use client";

import {
	ArrowRight,
	Copy,
	Eye,
	EyeOff,
	Key,
	Loader2,
	RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ApiKeySectionProps {
	apiKey: string;
	uiUrl: string;
	onRotate: () => void | Promise<void>;
	isRotating: boolean;
}

export default function ApiKeySection({
	apiKey,
	uiUrl,
	onRotate,
	isRotating,
}: ApiKeySectionProps) {
	const [visible, setVisible] = useState(false);
	const [confirmingRotate, setConfirmingRotate] = useState(false);

	const copy = async () => {
		await navigator.clipboard.writeText(apiKey);
		toast.success("Copied to clipboard");
	};

	const handleRotateClick = async () => {
		if (!confirmingRotate) {
			setConfirmingRotate(true);
			window.setTimeout(() => setConfirmingRotate(false), 4000);
			return;
		}
		setConfirmingRotate(false);
		await onRotate();
	};

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				<Key className="h-4 w-4 text-muted-foreground" />
				<h3 className="text-sm font-medium">API Key</h3>
			</div>
			<div className="flex gap-2">
				<Input
					type={visible ? "text" : "password"}
					value={apiKey}
					readOnly
					className="font-mono text-sm h-9"
				/>
				<Button
					variant="outline"
					size="icon"
					className="h-9 w-9 shrink-0"
					onClick={() => setVisible(!visible)}
					title={visible ? "Hide" : "Reveal"}
				>
					{visible ? (
						<EyeOff className="h-3.5 w-3.5" />
					) : (
						<Eye className="h-3.5 w-3.5" />
					)}
				</Button>
				<Button
					variant="outline"
					size="icon"
					className="h-9 w-9 shrink-0"
					onClick={copy}
					title="Copy"
				>
					<Copy className="h-3.5 w-3.5" />
				</Button>
				<Button
					variant={confirmingRotate ? "destructive" : "outline"}
					size="icon"
					className="h-9 w-9 shrink-0"
					onClick={handleRotateClick}
					disabled={isRotating}
					title={
						confirmingRotate
							? "Click again to confirm — this invalidates the current key"
							: "Rotate key"
					}
				>
					{isRotating ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" />
					) : (
						<RefreshCw
							className={`h-3.5 w-3.5 ${confirmingRotate ? "animate-pulse" : ""}`}
						/>
					)}
				</Button>
			</div>
			{confirmingRotate && !isRotating && (
				<p className="text-xs text-amber-600 dark:text-amber-400">
					Click rotate again to confirm. The current key will stop working
					immediately.
				</p>
			)}
			<div className="flex items-center gap-4 text-xs text-muted-foreground">
				<Link
					href="/guides"
					className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
				>
					Setup guides
					<ArrowRight className="h-3 w-3" />
				</Link>
				<a
					href={`${uiUrl}/models?coding=true`}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
				>
					All models
					<ArrowRight className="h-3 w-3" />
				</a>
			</div>
		</div>
	);
}
