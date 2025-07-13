import { Copy } from "lucide-react";
import { useTheme } from "next-themes";
import { Highlight, themes } from "prism-react-renderer";
import { useState } from "react";

import { Button } from "@/lib/components/button";
import { toast } from "@/lib/components/use-toast";
import { cn } from "@/lib/utils";

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

export function CodeExample() {
	const [activeTab, setActiveTab] =
		useState<keyof typeof codeExamples>("python");
	const { resolvedTheme } = useTheme();

	const copyToClipboard = async (text: string, language: string) => {
		try {
			await navigator.clipboard.writeText(text);
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
		<section className="py-20 border-b border-zinc-200 dark:border-zinc-800">
			<div className="container mx-auto px-4">
				<div className="max-w-4xl mx-auto">
					<h2 className="text-3xl font-bold tracking-tight mb-6 text-center text-zinc-900 dark:text-white">
						Simple Integration
					</h2>

					<p className="text-zinc-600 dark:text-zinc-400 text-center mb-10">
						Just change your API endpoint and keep your existing code. Works
						with any language or framework.
					</p>

					{/* Language Tabs */}
					<div className="mb-6">
						<div className="flex flex-wrap gap-2 justify-center">
							{Object.entries(codeExamples).map(([key, example]) => (
								<button
									key={key}
									onClick={() => setActiveTab(key as keyof typeof codeExamples)}
									className={`px-3 py-2 text-sm font-medium rounded-md transition-colors cursor-pointer ${
										activeTab === key
											? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
											: "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
									}`}
								>
									{example.label}
								</button>
							))}
						</div>
					</div>

					{/* Code Block */}
					<div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 shadow-sm">
						<div className="flex items-center justify-between bg-zinc-50 dark:bg-zinc-900 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
							<span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
								{currentExample.label} Example
							</span>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="h-8 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
								onClick={() =>
									copyToClipboard(currentExample.code, currentExample.label)
								}
							>
								<Copy className="h-4 w-4 mr-1" />
								Copy
							</Button>
						</div>

						<div className="relative bg-white dark:bg-zinc-950">
							<Highlight
								code={currentExample.code}
								language={currentExample.language as Language}
								theme={
									resolvedTheme === "dark" ? themes.dracula : themes.github
								}
							>
								{({
									className,
									style,
									tokens,
									getLineProps,
									getTokenProps,
								}: {
									className: string;
									style: React.CSSProperties;
									tokens: any[];
									getLineProps: (props: any) => any;
									getTokenProps: (props: any) => any;
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
										{tokens.map((line: any, i: number) => (
											<div key={i} {...getLineProps({ line, key: i })}>
												{line.map((token: any, key: number) => (
													<span key={key} {...getTokenProps({ token, key })} />
												))}
											</div>
										))}
									</pre>
								)}
							</Highlight>
						</div>
					</div>

					<p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
						LLM Gateway routes your request to the appropriate provider while
						tracking usage and performance across all languages and frameworks.
					</p>
				</div>
			</div>
		</section>
	);
}
