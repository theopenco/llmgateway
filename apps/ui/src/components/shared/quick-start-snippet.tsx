"use client";

import { Code, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/lib/components/button";
import { Card, CardContent } from "@/lib/components/card";
import { toast } from "@/lib/components/use-toast";

export function QuickStartSection({
	apiKey,
	onCopy,
}: {
	apiKey?: string;
	onCopy?: () => void;
}) {
	const [activeTab, setActiveTab] = useState<"curl" | "typescript">("curl");

	const keyPlaceholder = apiKey ?? "YOUR_API_KEY";

	const curlExample = `curl -X POST https://api.llmgateway.io/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${keyPlaceholder}" \\
  -d '{
  "model": "auto",
  "free_models_only": true,
  "messages": [
    {"role": "user", "content": "Hello!"}
  ]
}'`;

	const tsExample = `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "${keyPlaceholder}",
  baseURL: "https://api.llmgateway.io/v1/"
});

const response = await client.chat.completions.create({
  model: "auto",
  messages: [{ role: "user", content: "Hello!" }],
  // @ts-expect-error LLM Gateway extension
  free_models_only: true,
});`;

	const code = activeTab === "curl" ? curlExample : tsExample;

	function copyCode() {
		void navigator.clipboard.writeText(code);
		onCopy?.();
		toast({
			title: "Copied to clipboard",
			description: "Code snippet copied to clipboard",
		});
	}

	return (
		<Card>
			<CardContent className="pt-6">
				<div className="flex flex-col gap-3">
					<div className="flex items-center gap-2">
						<Code className="h-5 w-5 text-muted-foreground" />
						<span className="font-medium">Quick Start</span>
					</div>
					<p className="text-sm text-muted-foreground">
						Use your API key to make requests. LLM Gateway is compatible with
						the OpenAI SDK — just change the base URL.
					</p>
					<div className="flex gap-2">
						<Button
							variant={activeTab === "curl" ? "default" : "outline"}
							size="sm"
							onClick={() => setActiveTab("curl")}
							type="button"
						>
							cURL
						</Button>
						<Button
							variant={activeTab === "typescript" ? "default" : "outline"}
							size="sm"
							onClick={() => setActiveTab("typescript")}
							type="button"
						>
							TypeScript
						</Button>
					</div>
					<div className="relative rounded-md border bg-muted/50">
						<Button
							variant="ghost"
							size="sm"
							onClick={copyCode}
							type="button"
							className="absolute right-2 top-2 h-7 w-7 p-0"
						>
							<Copy className="h-3.5 w-3.5" />
							<span className="sr-only">Copy code</span>
						</Button>
						<pre className="overflow-x-auto p-4 text-xs font-mono leading-relaxed">
							{code}
						</pre>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
