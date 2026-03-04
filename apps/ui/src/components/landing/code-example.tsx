"use client";

import { Check, Copy } from "lucide-react";
import { useTheme } from "next-themes";
import { Highlight, themes } from "prism-react-renderer";
import { useState, useEffect } from "react";

import { Button } from "@/lib/components/button";
import { toast } from "@/lib/components/use-toast";
import { cn } from "@/lib/utils";

import { AnimatedGroup } from "./animated-group";

import type { Language } from "prism-react-renderer";

const codeExamples = {
	curl: {
		label: "cURL",
		language: "bash",
		code: `curl -X POST https://api.llmgateway.io/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \\
  -d '{
  "model": "gpt-4o",
  "messages": [
    {"role": "user", "content": "Hello, how are you?"}
  ]
}'`,
	},
	typescript: {
		label: "TypeScript",
		language: "typescript",
		code: `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.LLM_GATEWAY_API_KEY, // or your API key string
  baseURL: "https://api.llmgateway.io/v1/"
});

const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [
    { role: "user", content: "Hello, how are you?" }
  ]
});

console.log(response.choices[0].message.content);`,
	},
	nextjs: {
		label: "Next.js",
		language: "typescript",
		code: `import { createLLMGateway } from "@llmgateway/ai-sdk-provider";
import { generateText } from 'ai';

const llmgateway = createLLMGateway({ apiKey });

const { text } = await generateText({
  model: llmgateway('openai/gpt-4o'),
  prompt: 'Write a vegetarian lasagna recipe for 4 people.',
});`,
	},
	python: {
		label: "Python",
		language: "python",
		code: `import openai

client = openai.OpenAI(
    api_key="YOUR_LLM_GATEWAY_API_KEY",
    base_url="https://api.llmgateway.io/v1"
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello, how are you?"}]
)
print(response.choices[0].message.content)
`,
	},
	java: {
		label: "Java",
		language: "java",
		code: `import com.theokanning.openai.OpenAiApi;
import com.theokanning.openai.OpenAiService;
import com.theokanning.openai.completion.chat.*;

import java.util.List;

public class Main {
    public static void main(String[] args) {
        String apiKey = System.getenv("LLM_GATEWAY_API_KEY");
        OpenAiService service = new OpenAiService(apiKey, 60);
        service.setOpenAiApiUrl("https://api.llmgateway.io/v1/");

        ChatMessage message = new ChatMessage("user", "Hello, how are you?");
        ChatCompletionRequest request = ChatCompletionRequest.builder()
            .model("gpt-4o")
            .messages(List.of(message))
            .build();

        ChatCompletionResult result = service.createChatCompletion(request);
        System.out.println(result.getChoices().get(0).getMessage().getContent());
    }
}
`,
	},
	rust: {
		label: "Rust",
		language: "rust",
		code: `use openai_api_rs::v1::chat::{ChatCompletionMessage, ChatCompletionRequest, ChatCompletionResponse};
use openai_api_rs::v1::OpenAI;
use std::env;

#[tokio::main]
async fn main() {
    let api_key = env::var("LLM_GATEWAY_API_KEY").unwrap();
    let openai = OpenAI::new(&api_key).with_base_url("https://api.llmgateway.io/v1");

    let request = ChatCompletionRequest::new(
        "gpt-4o",
        vec![ChatCompletionMessage::user("Hello, how are you?")]
    );

    let response: ChatCompletionResponse = openai.chat().create(request).await.unwrap();
    println!("{}", response.choices[0].message.content);
}
`,
	},
	go: {
		label: "Go",
		language: "go",
		code: `package main

import (
    "context"
    "fmt"
    "os"

    openai "github.com/sashabaranov/go-openai"
)

func main() {
    client := openai.NewClientWithConfig(openai.DefaultConfig(os.Getenv("LLM_GATEWAY_API_KEY"), "https://api.llmgateway.io/v1"))
    resp, err := client.CreateChatCompletion(
        context.Background(),
        openai.ChatCompletionRequest{
            Model: "gpt-4o",
            Messages: []openai.ChatCompletionMessage{
                {Role: openai.ChatMessageRoleUser, Content: "Hello, how are you?"},
            },
        },
    )
    if err != nil {
        panic(err)
    }
    fmt.Println(resp.Choices[0].Message.Content)
}
`,
	},
	php: {
		label: "PHP",
		language: "php",
		code: `<?php
require 'vendor/autoload.php';

$client = OpenAI::client('YOUR_LLM_GATEWAY_API_KEY', [
    'base_uri' => 'https://api.llmgateway.io/v1',
]);

$response = $client->chat()->create([
    'model' => 'gpt-4o',
    'messages' => [
        ['role' => 'user', 'content' => 'Hello, how are you?']
    ],
]);

echo $response['choices'][0]['message']['content'];
?>`,
	},
	ruby: {
		label: "Ruby",
		language: "ruby",
		code: `require "openai"

client = OpenAI::Client.new(
  access_token: ENV["LLM_GATEWAY_API_KEY"],
  uri_base: "https://api.llmgateway.io/v1"
)

response = client.chat(
  parameters: {
    model: "gpt-4o",
    messages: [{ role: "user", content: "Hello, how are you?" }]
  }
)

puts response.dig("choices", 0, "message", "content")
`,
	},
};

const bullets = [
	"Works with OpenAI, Anthropic, and Vercel AI SDKs",
	"Change one line — your base URL",
	"Every request tracked with cost, latency, and token usage",
];

export function CodeExample() {
	const [activeTab, setActiveTab] =
		useState<keyof typeof codeExamples>("python");
	const { resolvedTheme } = useTheme();
	const [mounted, setMounted] = useState(false);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	const copyToClipboard = async (text: string, language: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
			toast({
				title: "Copied to clipboard",
				description: `${language} code snippet has been copied to your clipboard.`,
				duration: 3000,
			});
		} catch (err) {
			console.error("Failed to copy text: ", err);
			toast({
				title: "Copy failed",
				description: "Could not copy to clipboard. Please try again.",
				variant: "destructive",
				duration: 3000,
			});
		}
	};

	const currentExample = codeExamples[activeTab];

	return (
		<section className="py-24 md:py-32">
			<div className="container mx-auto px-4">
				<div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start">
					{/* Left column: heading, description, bullets, tabs */}
					<AnimatedGroup preset="blur-slide" className="flex flex-col gap-6">
						<div>
							<p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-4">
								Integration
							</p>
							<h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight text-foreground">
								Drop-in compatible.
								<br />
								Zero learning curve.
							</h2>
						</div>

						<p className="text-muted-foreground text-lg">
							Already using OpenAI's SDK? Change one line—your base URL—and
							you're done. Works with any language or framework.
						</p>

						<ul className="space-y-3">
							{bullets.map((bullet) => (
								<li
									key={bullet}
									className="flex items-start gap-3 text-muted-foreground"
								>
									<div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-foreground/40 shrink-0" />
									<span>{bullet}</span>
								</li>
							))}
						</ul>

						{/* Vertical language tabs (desktop) */}
						<div className="hidden lg:flex flex-col gap-1 mt-4">
							{Object.entries(codeExamples).map(([key, example]) => (
								<button
									key={key}
									onClick={() => setActiveTab(key as keyof typeof codeExamples)}
									className={cn(
										"px-4 py-2 text-sm font-medium rounded-lg text-left transition-colors",
										activeTab === key
											? "bg-foreground text-background"
											: "text-muted-foreground hover:bg-muted",
									)}
								>
									{example.label}
								</button>
							))}
						</div>
					</AnimatedGroup>

					{/* Right column: code block (sticky on desktop) */}
					<div className="relative lg:sticky lg:top-24">
						{/* Faint glow behind code block */}
						<div className="absolute -inset-4 bg-blue-500/5 dark:bg-blue-400/5 rounded-3xl blur-2xl pointer-events-none" />

						{/* Horizontal tabs (mobile) */}
						<div className="lg:hidden mb-4">
							<div className="flex flex-wrap gap-2">
								{Object.entries(codeExamples).map(([key, example]) => (
									<button
										key={key}
										onClick={() =>
											setActiveTab(key as keyof typeof codeExamples)
										}
										className={cn(
											"px-3 py-2 text-sm font-medium rounded-lg transition-colors",
											activeTab === key
												? "bg-foreground text-background"
												: "text-muted-foreground hover:bg-muted",
										)}
									>
										{example.label}
									</button>
								))}
							</div>
						</div>

						<div className="relative overflow-hidden rounded-2xl border border-border shadow-2xl">
							{/* macOS-style header */}
							<div className="flex items-center justify-between bg-muted/50 backdrop-blur-sm px-4 py-3 border-b border-border">
								<div className="flex items-center gap-3">
									<div className="flex items-center gap-2">
										<div className="h-3 w-3 rounded-full bg-[#FF5F57]" />
										<div className="h-3 w-3 rounded-full bg-[#FEBC2E]" />
										<div className="h-3 w-3 rounded-full bg-[#28C840]" />
									</div>
									<span className="text-sm font-medium text-muted-foreground ml-2">
										{currentExample.label}
									</span>
								</div>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-8 text-muted-foreground hover:text-foreground"
									onClick={() =>
										copyToClipboard(currentExample.code, currentExample.label)
									}
								>
									{copied ? (
										<Check className="h-4 w-4 mr-1" />
									) : (
										<Copy className="h-4 w-4 mr-1" />
									)}
									{copied ? "Copied" : "Copy"}
								</Button>
							</div>

							<div className="relative bg-background">
								<Highlight
									code={currentExample.code}
									language={currentExample.language as Language}
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
												"p-6 overflow-x-auto text-sm leading-relaxed font-mono max-h-96 overflow-y-auto",
												className,
											)}
											style={{
												...style,
												padding: 24,
												borderRadius: 0,
												overflowX: "auto",
											}}
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
				</div>
			</div>
		</section>
	);
}
