"use client";

import { Copy, Code2 } from "lucide-react";
import { useTheme } from "next-themes";
import { Highlight, themes } from "prism-react-renderer";
import { useState, useEffect } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import type { Language } from "prism-react-renderer";

interface ModelCodeExampleDialogProps {
	modelId: string;
}

export function ModelCodeExampleDialog({
	modelId,
}: ModelCodeExampleDialogProps) {
	const [activeTab, setActiveTab] = useState<"curl" | "openai" | "ai-sdk">(
		"curl",
	);
	const { resolvedTheme } = useTheme();
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	const codeExamples: {
		[key: string]: {
			label: string;
			language: Language;
			code: string;
		};
	} = {
		curl: {
			label: "cURL",
			language: "bash",
			code: `curl -X POST https://api.llmgateway.io/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \\
  -d '{
  "model": "${modelId}",
  "messages": [
    {"role": "user", "content": "Hello, how are you?"}
  ]
}'`,
		},
		openai: {
			label: "OpenAI SDK",
			language: "typescript",
			code: `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.LLM_GATEWAY_API_KEY, // or your API key string
  baseURL: "https://api.llmgateway.io/v1/"
});

const response = await client.chat.completions.create({
  model: "${modelId}",
  messages: [
    { role: "user", content: "Hello, how are you?" }
  ]
});

console.log(response.choices[0].message.content);`,
		},
		"ai-sdk": {
			label: "AI SDK",
			language: "typescript",
			code: `import { createLLMGateway } from "@llmgateway/ai-sdk-provider";
import { generateText } from "ai";

const llmgateway = createLLMGateway({ apiKey: process.env.LLM_GATEWAY_API_KEY });

const { text } = await generateText({
  model: llmgateway("${modelId}"),
  prompt: "Write a vegetarian lasagna recipe for 4 people.",
});`,
		},
	};

	const currentExample = codeExamples[activeTab];

	const copyToClipboard = async (text: string, languageLabel: string) => {
		try {
			await navigator.clipboard.writeText(text);
			toast.success("Copied to clipboard", {
				description: `${languageLabel} example has been copied to your clipboard.`,
				duration: 3000,
			});
		} catch (err) {
			console.error("Failed to copy text: ", err);
			toast.error("Copy failed", {
				description: "Could not copy to clipboard. Please try again.",
				duration: 3000,
			});
		}
	};

	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="h-5 w-5 p-0"
					type="button"
					aria-label="View code examples"
				>
					<Code2 className="h-3 w-3" />
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Use this model with LLM Gateway</DialogTitle>
					<DialogDescription>
						Code examples for{" "}
						<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
							{modelId}
						</code>{" "}
						using cURL, the OpenAI SDK, and the AI SDK.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="flex flex-wrap gap-2">
						{(
							Object.keys(codeExamples) as Array<"curl" | "openai" | "ai-sdk">
						).map((key) => {
							const example = codeExamples[key];
							return (
								<button
									key={key}
									type="button"
									onClick={() => setActiveTab(key)}
									className={cn(
										"rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
										activeTab === key
											? "bg-primary text-primary-foreground"
											: "bg-muted text-muted-foreground hover:bg-muted/80",
									)}
								>
									{example.label}
								</button>
							);
						})}
					</div>

					<div className="overflow-hidden rounded-md border bg-card">
						<div className="flex items-center justify-between border-b bg-muted px-3 py-2">
							<span className="text-xs font-medium text-muted-foreground">
								{currentExample.label} example
							</span>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="h-7 px-2 text-xs"
								onClick={() =>
									copyToClipboard(currentExample.code, currentExample.label)
								}
							>
								<Copy className="mr-1 h-3 w-3" />
								Copy
							</Button>
						</div>
						<div className="bg-background">
							<Highlight
								code={currentExample.code}
								language={currentExample.language}
								theme={
									mounted && resolvedTheme === "dark"
										? themes.dracula
										: themes.github
								}
							>
								{({
									className,
									style,
									tokens,
									getLineProps,
									getTokenProps,
								}) => (
									<pre
										className={cn(
											"max-h-80 overflow-auto p-4 text-xs leading-relaxed font-mono",
											className,
										)}
										style={style}
									>
										{tokens.map((line, i) => {
											const lineProps = getLineProps({ line });
											return (
												<div key={i} {...lineProps}>
													{line.map((token, key) => {
														const tokenProps = getTokenProps({ token });
														return <span key={key} {...tokenProps} />;
													})}
												</div>
											);
										})}
									</pre>
								)}
							</Highlight>
						</div>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
