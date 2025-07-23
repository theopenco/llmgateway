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

interface ModelProvider {
	providerId: string;
	modelName: string;
	contextSize?: number;
	inputPrice?: number;
	outputPrice?: number;
	requestPrice?: number;
}

interface ModelCardProps {
	model: {
		model: string;
		providers: ModelProvider[];
	};
}

export function ModelCard({ model }: ModelCardProps) {
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

	const provider = model.providers[0];
	const providerModelName = `${provider.providerId}/${model.model}`;

	return (
		<Card key={model.model} className="flex flex-col h-full">
			<CardHeader className="pb-2">
				<div className="flex items-start justify-between gap-2">
					<div className="flex-1 min-w-0">
						<CardTitle className="text-base leading-tight line-clamp-1">
							{model.model}
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
					<p className="text-xs text-muted-foreground">
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
				)}
			</CardContent>
			<CardFooter className="mt-auto pt-4">
				<Button asChild variant="secondary" className="w-full">
					<Link href={`/models/${encodeURIComponent(model.model)}`}>
						See more details
					</Link>
				</Button>
			</CardFooter>
		</Card>
	);
}
