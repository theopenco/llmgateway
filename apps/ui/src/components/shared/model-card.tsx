"use client";

import { Copy, Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { formatContextSize } from "@/lib/utils";

import type { ProviderModelMapping } from "@llmgateway/models";

interface ModelCardProps {
	modelName: string;
	providers: ProviderModelMapping[];
}

export function ModelCard({ modelName, providers }: ModelCardProps) {
	const [copiedText, setCopiedText] = useState<string | null>(null);

	const copyToClipboard = async (text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopiedText(text);
			setTimeout(() => setCopiedText(null), 2000);
		} catch (err) {
			console.error("Failed to copy text:", err);
		}
	};

	// Safety check: ensure providers array is non-empty
	if (!providers || providers.length === 0) {
		return (
			<Card className="flex flex-col h-full">
				<CardHeader className="pb-2">
					<CardTitle className="text-base leading-tight line-clamp-1">
						{modelName}
					</CardTitle>
					<CardDescription className="text-xs text-muted-foreground">
						No providers available
					</CardDescription>
				</CardHeader>
				<CardContent className="flex items-center justify-center py-8">
					<p className="text-sm text-muted-foreground">
						This model is currently not available through any providers.
					</p>
				</CardContent>
			</Card>
		);
	}

	const provider = providers[0];
	const providerModelName = `${provider.providerId}/${modelName}`;

	return (
		<Card className="flex flex-col h-full">
			<CardHeader className="pb-2">
				<div className="flex items-start justify-between gap-2">
					<div className="flex-1 min-w-0">
						<CardTitle className="text-base leading-tight line-clamp-1">
							{modelName}
						</CardTitle>
						<CardDescription className="text-xs">
							{provider.modelName}
						</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-2">
				{/* Model Name Copy Section */}
				<div className="flex items-center justify-between gap-2">
					<div className="flex-1 min-w-0">
						<code className="text-xs bg-muted px-2 py-1 rounded font-mono break-all">
							{providerModelName}
						</code>
					</div>
					<Button
						variant="ghost"
						size="sm"
						className="h-6 w-6 p-0 shrink-0"
						onClick={(e) => {
							e.preventDefault();
							copyToClipboard(providerModelName);
						}}
						title="Copy provider/model name"
					>
						{copiedText === providerModelName ? (
							<Check className="h-3 w-3 text-green-600" />
						) : (
							<Copy className="h-3 w-3" />
						)}
					</Button>
				</div>

				{provider.contextSize && (
					<p className="text-xs text-muted-foreground">
						Context:{" "}
						<span className="font-mono text-foreground font-bold">
							{formatContextSize(provider.contextSize)}
						</span>
					</p>
				)}
				{(provider.inputPrice !== undefined ||
					provider.outputPrice !== undefined ||
					provider.requestPrice !== undefined) && (
					<div className="text-xs text-muted-foreground">
						<p>
							{provider.inputPrice !== undefined && (
								<>
									<span className="font-mono text-foreground font-bold">
										${(provider.inputPrice * 1e6).toFixed(2)}
									</span>{" "}
									<span className="text-muted-foreground">in</span>
								</>
							)}

							{provider.outputPrice !== undefined && (
								<>
									<span className="text-muted-foreground mx-2">/</span>
									<span className="font-mono text-foreground font-bold">
										${(provider.outputPrice * 1e6).toFixed(2)}
									</span>{" "}
									<span className="text-muted-foreground">out</span>
								</>
							)}
							{provider.requestPrice !== undefined &&
								provider.requestPrice !== 0 &&
								` / $${(provider.requestPrice * 1000).toFixed(2)} per 1K req`}
						</p>
						{provider.pricingTiers && provider.pricingTiers.length > 1 && (
							<p className="text-muted-foreground/70 text-[10px] mt-0.5">
								Tiered pricing available
							</p>
						)}
					</div>
				)}
			</CardContent>
			<CardFooter className="mt-auto pt-4">
				<Button asChild variant="secondary" className="w-full">
					<Link href={`/models/${encodeURIComponent(modelName)}`}>
						See more details
					</Link>
				</Button>
			</CardFooter>
		</Card>
	);
}
