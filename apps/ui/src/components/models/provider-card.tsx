"use client";

import { Copy, Check } from "lucide-react";
import { useState } from "react";

import { getProviderIcon } from "@/components/ui/providers-icons";
import { Button } from "@/lib/components/button";
import { Card, CardContent } from "@/lib/components/card";
import { formatContextSize } from "@/lib/utils";

import type {
	ProviderModelMapping,
	ProviderDefinition,
} from "@llmgateway/models";

interface ProviderWithInfo extends ProviderModelMapping {
	providerInfo?: ProviderDefinition;
}

interface ProviderCardProps {
	provider: ProviderWithInfo;
	modelName: string;
}

export function ProviderCard({ provider, modelName }: ProviderCardProps) {
	const [copied, setCopied] = useState(false);
	const providerModelName = `${provider.providerId}/${modelName}`;
	const ProviderIcon = getProviderIcon(provider.providerId);

	const copyToClipboard = async () => {
		try {
			await navigator.clipboard.writeText(providerModelName);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (err) {
			console.error("Failed to copy:", err);
		}
	};

	return (
		<Card>
			<CardContent className="p-6">
				<div className="flex items-center justify-between mb-4">
					<div className="flex items-center gap-3">
						<div className="w-12 h-12 bg-muted rounded flex items-center justify-center">
							{ProviderIcon ? (
								<ProviderIcon className="h-10 w-10" />
							) : (
								provider.providerInfo?.name?.charAt(0) || "?"
							)}
						</div>
						<div>
							<h3 className="font-semibold">
								{provider.providerInfo?.name || provider.providerId}
							</h3>
							<div className="flex items-center gap-2">
								<code className="text-xs bg-muted px-2 py-1 rounded font-mono">
									{providerModelName}
								</code>
								<Button
									variant="ghost"
									size="sm"
									onClick={copyToClipboard}
									className="h-5 w-5 p-0"
								>
									{copied ? (
										<Check className="h-3 w-3 text-green-600" />
									) : (
										<Copy className="h-3 w-3" />
									)}
								</Button>
							</div>
						</div>
					</div>
				</div>

				<div className="grid grid-cols-3 gap-4 text-sm">
					<div>
						<div className="text-muted-foreground mb-1">Context</div>
						<div className="font-mono">
							{provider.contextSize
								? formatContextSize(provider.contextSize)
								: "—"}
						</div>
					</div>
					<div>
						<div className="text-muted-foreground mb-1">Input</div>
						<div className="font-mono">
							{provider.inputPrice
								? `$${(provider.inputPrice * 1e6).toFixed(2)}`
								: "—"}
						</div>
					</div>
					<div>
						<div className="text-muted-foreground mb-1">Output</div>
						<div className="font-mono">
							{provider.outputPrice
								? `$${(provider.outputPrice * 1e6).toFixed(2)}`
								: "—"}
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
