export interface GlossaryTerm {
	slug: string;
	term: string;
	question: string;
	aliases: string[];
	definition: string;
	sections: Array<{ heading: string; text: string }>;
	links: Array<{ label: string; href: string }>;
	related: string[];
}

export const GLOSSARY_UPDATED_AT = "2026-11-20";

export const glossaryTerms: GlossaryTerm[] = [
	{
		slug: "ai-gateway",
		question: "What is an AI gateway?",
		term: "AI gateway",
		aliases: ["LLM gateway", "LLM API gateway"],
		definition:
			"An AI gateway is a service that sits between your application and AI model providers. It exposes one API and one key, forwards each request to the right provider, and adds the controls a single provider does not: failover, cost tracking, rate limits, caching, and access policies across every model you use.",
		sections: [
			{
				heading: "Why teams use one",
				text: "Calling each provider directly means a separate SDK, key, bill, and rate limit for each. A gateway replaces that with one integration. Switching models becomes a change to the model field, and an outage at one provider no longer takes your feature down.",
			},
			{
				heading: "How LLM Gateway works",
				text: "LLM Gateway exposes an OpenAI-compatible endpoint at https://api.llmgateway.io/v1. Change the base URL and API key in an OpenAI SDK and the same code reaches models from every supported provider. Requests that name only a model are retried on another provider when the first one fails.",
			},
		],
		links: [
			{ label: "Quick start", href: "https://docs.llmgateway.io/quick-start" },
			{ label: "Routing", href: "https://docs.llmgateway.io/features/routing" },
		],
		related: ["llm-routing", "provider-fallback", "bring-your-own-key"],
	},
	{
		slug: "token",
		question: "What is a token in an LLM?",
		term: "Token",
		aliases: ["LLM token"],
		definition:
			"A token is the unit of text a language model reads and writes. Models split text into tokens, which are often word fragments: one token is roughly four characters of English. Providers price requests per token and limit how many tokens a request may contain, so token counts drive both cost and context limits.",
		sections: [
			{
				heading: "Input and output tokens",
				text: "Input tokens are everything you send: system prompt, conversation history, tool definitions, and documents. Output tokens are what the model generates. Output tokens usually cost several times more than input tokens, so long answers cost more than long prompts of the same size.",
			},
			{
				heading: "Counts differ between models",
				text: "Each model family uses its own tokenizer, so the same text produces a different count on different models. Treat any count from one tokenizer as an estimate for another model, and rely on the usage block in the API response for billing.",
			},
		],
		links: [
			{ label: "Token counter", href: "/token-counter" },
			{ label: "Token cost calculator", href: "/token-cost-calculator" },
		],
		related: ["context-window", "reasoning-tokens", "prompt-caching"],
	},
	{
		slug: "context-window",
		question: "What is a context window?",
		term: "Context window",
		aliases: ["Context length", "Context size"],
		definition:
			"A context window is the maximum number of tokens a model can process in one request, counting the prompt, the conversation history, any documents or tool definitions, and the response it generates. Text beyond the limit is rejected or must be removed, so the context window sets how much a model can consider at once.",
		sections: [
			{
				heading: "Why it matters",
				text: "A larger window lets you send whole documents, long conversations, or a full codebase in one request. It also raises cost, because every token in the window is billed as input on each call.",
			},
			{
				heading: "The same model can have different windows",
				text: "Providers do not always serve a model with the same limits. One deployment may offer the full window while another caps it lower. LLM Gateway routes requests that name only a model to deployments that offer the model's full context window.",
			},
		],
		links: [
			{ label: "Context window checker", href: "/context-window-checker" },
			{ label: "Long-context models", href: "/models/long-context" },
		],
		related: ["token", "prompt-caching"],
	},
	{
		slug: "prompt-caching",
		question: "What is prompt caching?",
		term: "Prompt caching",
		aliases: ["Context caching", "Cached input tokens"],
		definition:
			"Prompt caching lets a provider store the beginning of a prompt after the first request and reuse it on later requests that start with the same text. Cached input tokens are billed at a lower rate than normal input tokens and are processed faster, which cuts cost and latency for long, repeated prompts.",
		sections: [
			{
				heading: "When it helps",
				text: "Caching pays off when many requests share a long prefix: a large system prompt, tool definitions, a document under discussion, or the earlier turns of a conversation. Put the stable content first and the changing content last so the shared prefix stays identical.",
			},
			{
				heading: "What it costs",
				text: "Providers publish a separate cached-input price, and some also charge to write the cache. Model pages on LLM Gateway list the cached input price per provider next to the normal input price.",
			},
		],
		links: [
			{ label: "Caching", href: "https://docs.llmgateway.io/features/caching" },
			{ label: "Model pricing", href: "/models" },
		],
		related: ["token", "context-window"],
	},
	{
		slug: "time-to-first-token",
		question: "What is time to first token (TTFT)?",
		term: "Time to first token (TTFT)",
		aliases: ["TTFT", "First-token latency"],
		definition:
			"Time to first token (TTFT) is the delay between sending a request and receiving the first piece of the model's response. It measures how responsive a streaming model feels. TTFT depends on the model, the provider serving it, prompt length, and current load, and it is separate from how fast tokens arrive afterward.",
		sections: [
			{
				heading: "TTFT versus throughput",
				text: "TTFT tells you how long a user waits before anything appears. Throughput, in tokens per second, tells you how long the full answer takes. A chat interface needs a low TTFT; a batch job cares about total time.",
			},
			{
				heading: "Comparing providers",
				text: "The same model can respond at different speeds on different providers. Model pages on LLM Gateway show measured performance per provider, so you can compare them before pinning one.",
			},
		],
		links: [
			{ label: "Model directory", href: "/models" },
			{ label: "Rankings", href: "/rankings" },
		],
		related: ["streaming", "llm-routing"],
	},
	{
		slug: "llm-routing",
		question: "What is LLM routing?",
		term: "LLM routing",
		aliases: ["Model routing", "Provider routing"],
		definition:
			"LLM routing is the choice of which provider, and sometimes which model, handles each request. A router weighs price, latency, uptime, and the features a request needs, then sends it to the best available option. Routing lets one application use many providers without hard-coding any of them.",
		sections: [
			{
				heading: "Model routing and provider routing",
				text: "Provider routing picks among the providers that serve the model you asked for. Model routing goes further and picks the model itself based on the request. Both aim for the same result: an acceptable answer at the lowest cost and delay.",
			},
			{
				heading: "Routing on LLM Gateway",
				text: "Request a model by its ID and the gateway selects a provider that can handle your prompt size and parameters. Prefix the ID with a provider, such as openai/gpt-4o, to pin one.",
			},
		],
		links: [
			{ label: "Routing", href: "https://docs.llmgateway.io/features/routing" },
		],
		related: ["provider-fallback", "ai-gateway"],
	},
	{
		slug: "provider-fallback",
		question: "What is provider fallback?",
		term: "Provider fallback",
		aliases: ["LLM failover", "Automatic failover"],
		definition:
			"Provider fallback is retrying a failed AI request on a different provider that serves the same model. When the first provider returns a server error, a rate limit, or a timeout, the request is sent to the next one inside the same API call, so the application receives an answer instead of an error.",
		sections: [
			{
				heading: "What triggers it",
				text: "Fallback applies to failures on the provider side: 5xx errors, timeouts, connection failures, and upstream rate limits. A request that is invalid fails the same way everywhere, so it is returned to the caller instead of retried.",
			},
			{
				heading: "When it does not run",
				text: "On LLM Gateway, fallback is skipped when you pin a provider, send the X-No-Fallback: true header, or no other provider serves the model.",
			},
		],
		links: [
			{
				label: "Automatic retry and fallback",
				href: "https://docs.llmgateway.io/features/routing#automatic-retry--fallback",
			},
			{ label: "Provider status", href: "/status" },
		],
		related: ["llm-routing", "rate-limit"],
	},
	{
		slug: "rate-limit",
		question: "What is a rate limit?",
		term: "Rate limit",
		aliases: ["RPM", "TPM", "429 error"],
		definition:
			"A rate limit is a cap on how much you can use an API in a period of time, usually counted in requests per minute or tokens per minute. When you exceed it the API returns HTTP 429 and refuses the request. Rate limits protect providers from overload and spread capacity across customers.",
		sections: [
			{
				heading: "Handling a 429",
				text: "Retry with exponential backoff and jitter, lower concurrency, and reduce tokens per request. If the limit comes from one provider, sending the request to another provider that serves the same model avoids the wait.",
			},
			{
				heading: "Two layers of limits",
				text: "Each model provider enforces its own limits on your account. A gateway adds its own limits on top. LLM Gateway treats an upstream 429 as a provider failure and retries it on another provider when one is available.",
			},
		],
		links: [
			{
				label: "Rate limits",
				href: "https://docs.llmgateway.io/resources/rate-limits",
			},
			{
				label: "Fix the OpenAI 429 error",
				href: "https://docs.llmgateway.io/troubleshooting/openai-429-rate-limit",
			},
		],
		related: ["provider-fallback", "token"],
	},
	{
		slug: "streaming",
		question: "What is streaming in an LLM API?",
		term: "Streaming",
		aliases: ["Server-sent events", "SSE streaming"],
		definition:
			"Streaming is delivering a model's response piece by piece as it is generated instead of waiting for the full answer. The API keeps the connection open and sends small chunks, typically as server-sent events. Users see text appear immediately, which makes long answers feel fast even when total generation time is unchanged.",
		sections: [
			{
				heading: "How to use it",
				text: "Set stream to true in a chat completions request and read the events as they arrive. Each event carries a fragment of the answer; the final events carry the finish reason and token usage.",
			},
			{
				heading: "Errors in a stream",
				text: "Once a stream has started, the HTTP status is already 200. An error that happens later arrives as an event in the stream, so clients must read errors from the event payload.",
			},
		],
		links: [
			{
				label: "API errors and streaming",
				href: "https://docs.llmgateway.io/resources/error-handling#streaming-errors",
			},
		],
		related: ["time-to-first-token", "token"],
	},
	{
		slug: "bring-your-own-key",
		question: "What is bring your own key (BYOK)?",
		term: "Bring your own key (BYOK)",
		aliases: ["BYOK", "Provider keys"],
		definition:
			"Bring your own key (BYOK) means using your own provider API keys through a gateway instead of buying usage from the gateway. Requests are billed by the provider on your existing account and agreements, while the gateway still supplies one API, routing, logging, and analytics across all of your keys.",
		sections: [
			{
				heading: "Why teams choose it",
				text: "BYOK keeps negotiated prices, committed spend, and provider-side quotas in place. It also keeps billing with a vendor your finance team already approved.",
			},
			{
				heading: "BYOK on LLM Gateway",
				text: "Add provider keys in the dashboard and requests for those providers use them. LLM Gateway charges no platform fee on requests made with your own keys.",
			},
		],
		links: [
			{
				label: "Provider keys",
				href: "https://docs.llmgateway.io/learn/provider-keys",
			},
			{ label: "Pricing", href: "/pricing" },
		],
		related: ["ai-gateway", "llm-routing"],
	},
	{
		slug: "structured-outputs",
		question: "What are structured outputs?",
		term: "Structured outputs",
		aliases: ["JSON mode", "JSON schema output"],
		definition:
			"Structured outputs make a model return data in a format your code can parse, usually JSON that matches a schema you supply. With strict schema enforcement the provider guarantees the response is valid against the schema. Without it, the model is only instructed to produce JSON and can still return something malformed.",
		sections: [
			{
				heading: "JSON mode versus a JSON schema",
				text: "JSON mode asks for any valid JSON object. A JSON schema names the exact fields and types. Support differs per model and per provider, so check both before relying on it.",
			},
			{
				heading: "Checking support",
				text: "Model pages on LLM Gateway state whether a model supports strict JSON schema output.",
			},
		],
		links: [
			{
				label: "Structured outputs",
				href: "https://docs.llmgateway.io/learn/structured-outputs",
			},
			{ label: "Model directory", href: "/models" },
		],
		related: ["tool-calling"],
	},
	{
		slug: "tool-calling",
		question: "What is tool calling?",
		term: "Tool calling",
		aliases: ["Function calling"],
		definition:
			"Tool calling lets a model ask your application to run a function instead of answering in text. You describe the available tools and their parameters; the model returns the tool name and arguments as structured data; your code runs the tool and sends the result back so the model can continue.",
		sections: [
			{
				heading: "What it enables",
				text: "Tool calling is how models search the web, query databases, edit files, and act inside agents. The model never executes anything itself: your application decides whether and how to run each call.",
			},
			{
				heading: "Support varies",
				text: "Not every model supports tools, and providers differ in which tool choice modes they accept. The model directory can be filtered to models that support tool calling.",
			},
		],
		links: [{ label: "Models with tool calling", href: "/models/tools" }],
		related: ["structured-outputs", "reasoning-tokens"],
	},
	{
		slug: "reasoning-tokens",
		question: "What are reasoning tokens?",
		term: "Reasoning tokens",
		aliases: ["Thinking tokens", "Extended thinking"],
		definition:
			"Reasoning tokens are tokens a model generates while working through a problem before it writes its final answer. They are billed as output tokens even when the provider does not show the reasoning text. Higher reasoning effort usually improves hard tasks and raises both cost and response time.",
		sections: [
			{
				heading: "Controlling effort",
				text: "Many reasoning models accept an effort setting from low to high. Use low effort for simple tasks and reserve high effort for problems that need multi-step work.",
			},
			{
				heading: "Reading the usage",
				text: "API responses report reasoning tokens as a detail of completion tokens, so you can see how much of the output cost came from reasoning.",
			},
		],
		links: [
			{
				label: "Reasoning",
				href: "https://docs.llmgateway.io/features/reasoning",
			},
			{ label: "Reasoning models", href: "/models/reasoning" },
		],
		related: ["token", "tool-calling"],
	},
	{
		slug: "embeddings",
		question: "What are embeddings?",
		term: "Embeddings",
		aliases: ["Text embeddings", "Vector embeddings"],
		definition:
			"An embedding is a list of numbers that represents the meaning of a piece of text. Texts with similar meaning produce vectors that are close together, so embeddings let software compare and search content by meaning instead of exact words. They are the basis of semantic search and retrieval-augmented generation.",
		sections: [
			{
				heading: "How they are used",
				text: "Split documents into chunks, embed each chunk, and store the vectors. At query time, embed the question and retrieve the closest chunks to give the model as context.",
			},
			{
				heading: "Pricing",
				text: "Embedding models are billed on input tokens only, since they return vectors rather than generated text.",
			},
		],
		links: [
			{
				label: "Embeddings",
				href: "https://docs.llmgateway.io/features/embeddings",
			},
			{ label: "Embedding models", href: "/models/embeddings" },
		],
		related: ["token", "context-window"],
	},
	{
		slug: "guardrails",
		question: "What are LLM guardrails?",
		term: "Guardrails",
		aliases: ["LLM guardrails", "AI guardrails"],
		definition:
			"Guardrails are checks applied to AI requests and responses to block or change content that breaks a policy. Typical rules detect personal data, secrets, prompt injection, and unsafe topics. Running them in a gateway applies the same rules to every model and application instead of rebuilding them in each codebase.",
		sections: [
			{
				heading: "Where they run",
				text: "Input guardrails inspect a prompt before it reaches a provider. Output guardrails inspect the response before it reaches the user. A rule can block the request, redact the matching text, or only record the event.",
			},
			{
				heading: "Guardrails on LLM Gateway",
				text: "Built-in content guardrails are part of the Enterprise plan.",
			},
		],
		links: [
			{
				label: "Guardrails",
				href: "https://docs.llmgateway.io/features/guardrails",
			},
			{ label: "Enterprise guardrails", href: "/enterprise/guardrails" },
		],
		related: ["zero-data-retention", "ai-gateway"],
	},
	{
		slug: "zero-data-retention",
		question: "What is zero data retention (ZDR)?",
		term: "Zero data retention (ZDR)",
		aliases: ["ZDR", "No prompt logging"],
		definition:
			"Zero data retention (ZDR) means a service does not store the content of your prompts and responses after it has processed them. Under ZDR a provider keeps no request payloads for logging, abuse review, or training. Teams handling sensitive data use it to limit where that data can persist.",
		sections: [
			{
				heading: "Two places data can be kept",
				text: "Data can be retained by the model provider and by anything in front of it, including a gateway. A ZDR setup has to cover both: provider-side retention terms and the gateway's own request logging.",
			},
			{
				heading: "On LLM Gateway",
				text: "Each organization chooses whether the gateway stores request payloads, and provider compliance policies on the Enterprise plan can restrict routing to providers that meet your data requirements.",
			},
		],
		links: [
			{
				label: "Data retention",
				href: "https://docs.llmgateway.io/features/data-retention",
			},
			{
				label: "Compliance policies",
				href: "https://docs.llmgateway.io/features/compliance",
			},
		],
		related: ["guardrails", "bring-your-own-key"],
	},
];

const termBySlug = new Map(glossaryTerms.map((term) => [term.slug, term]));

export function getGlossaryTerm(slug: string): GlossaryTerm | undefined {
	return termBySlug.get(slug);
}
