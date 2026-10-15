import {
	AudioLines,
	Bell,
	BookOpenText,
	BrainCircuit,
	Building2,
	Captions,
	Clapperboard,
	Coins,
	DatabaseZap,
	Eye,
	FileScan,
	FileText,
	Fingerprint,
	Gauge,
	Globe,
	ImageIcon,
	KeyRound,
	Layers,
	LibraryBig,
	ListOrdered,
	MessageSquareCode,
	Mic,
	Network,
	NotebookPen,
	Puzzle,
	Radio,
	Receipt,
	Route,
	ScrollText,
	Search,
	ShieldAlert,
	ShieldCheck,
	Signpost,
	Split,
	Tags,
	Timer,
	UserCog,
	Wrench,
} from "lucide-react";

import type { FeatureDefinition } from "./features";

const curl = (path: string, body: string, headers: string[] = []) =>
	[
		`curl https://api.llmgateway.io${path} \\`,
		'  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \\',
		'  -H "Content-Type: application/json" \\',
		...headers.map((header) => `  -H "${header}" \\`),
		`  -d '${JSON.stringify(JSON.parse(body), null, 2).replaceAll("\n", "\n  ")}'`,
	].join("\n");

export const docFeatures: FeatureDefinition[] = [
	{
		id: "anthropic-endpoint",
		slug: "anthropic-endpoint",
		title: "Anthropic-Compatible API",
		subtitle: "Point Claude Code at any model",
		description:
			"Use the Anthropic Messages API format at /v1/messages to call any model in the catalog, including from Claude Code.",
		longDescription:
			"LLM Gateway exposes a native Anthropic-compatible endpoint. Requests in the Messages format are translated for any model in the catalog and answered back in Anthropic's format, so Claude-first apps and tools work unchanged.",
		icon: MessageSquareCode,
		category: "routing",
		docsPath: "/features/anthropic-endpoint",
		visual: {
			kind: "flow",
			source: "Claude Code",
			hub: "/v1/messages",
			targets: [
				{ label: "claude-sonnet", status: "active", note: "Anthropic" },
				{ label: "gpt-5", status: "active", note: "OpenAI" },
				{ label: "gemini-3-pro", status: "active", note: "Google" },
				{ label: "glm-5", status: "idle", note: "Zhipu" },
			],
			caption: "Same Messages format, any model",
		},
		benefits: [
			{ title: "Drop-in", description: "Swap the base URL and token. Done." },
			{
				title: "Any model",
				description: "Claude format in, every catalog model out.",
			},
			{
				title: "Claude Code ready",
				description: "Three env vars and you're running.",
			},
			{
				title: "Streaming + tools",
				description: "Tool use and streaming translated.",
			},
		],
		useCases: [
			{
				title: "Claude Code on any model",
				description: "Run the CLI on GPT, Gemini or open models",
			},
			{
				title: "Claude-first apps",
				description: "Keep the Anthropic SDK, add more models",
			},
			{
				title: "Cost control",
				description: "Route agent work to cheaper models",
			},
		],
		codeExample: {
			title: "Run Claude Code through the gateway",
			language: "bash",
			code: `export ANTHROPIC_BASE_URL=https://api.llmgateway.io
export ANTHROPIC_AUTH_TOKEN=$LLM_GATEWAY_API_KEY
export ANTHROPIC_MODEL=gpt-5

claude`,
		},
	},
	{
		id: "routing",
		slug: "routing",
		title: "Smart Routing & Fallback",
		subtitle: "The best provider, every request",
		description:
			"Route each request to the best available provider by price, uptime and latency, with automatic retry and fallback when one fails.",
		longDescription:
			"Name a model and LLM Gateway picks the provider. If that provider errors or times out, the request is retried on the next best one automatically, so your users never see the outage.",
		icon: Route,
		category: "routing",
		docsPath: "/features/routing",
		visual: {
			kind: "flow",
			source: "Your app",
			hub: "LLM Gateway",
			targets: [
				{ label: "Provider A", status: "blocked", note: "503 · skipped" },
				{ label: "Provider B", status: "fallback", note: "retried here" },
				{ label: "Provider C", status: "idle", note: "standby" },
			],
			caption: "Automatic retry on the next best provider",
		},
		benefits: [
			{
				title: "Auto routing",
				description: "Price, uptime and latency weighed per request.",
			},
			{
				title: "Retry & fallback",
				description: "Failures move to the next provider.",
			},
			{
				title: "Provider pinning",
				description: "Prefix a model to lock the provider.",
			},
			{
				title: "Routing savings",
				description: "See what smart routing saved you.",
			},
		],
		useCases: [
			{
				title: "High availability",
				description: "Survive provider outages without code",
			},
			{ title: "Lower spend", description: "Cheapest healthy provider wins" },
			{
				title: "Per-project rules",
				description: "Tune routing per project on Enterprise",
			},
		],
		codeExample: {
			title: "Let the gateway choose",
			language: "bash",
			code: curl(
				"/v1/chat/completions",
				'{"model": "gpt-4o", "messages": [{"role": "user", "content": "Hello!"}]}',
			),
		},
	},
	{
		id: "dynamic-routes",
		slug: "dynamic-routes",
		title: "Dynamic Routes",
		subtitle: "Routing logic, out of your code",
		description:
			"Define named, versioned routing flows with conditions, percentage splits and model targets, then call them with dynamic/<name>.",
		longDescription:
			"Build a routing graph in the gateway instead of hardcoding models. Branch on headers, body fields or plan, split traffic by percentage, and roll back to any version.",
		icon: Split,
		category: "routing",
		docsPath: "/features/dynamic-routes",
		enterprise: true,
		visual: {
			kind: "flow",
			source: "dynamic/support",
			hub: "x-user-tier?",
			targets: [
				{ label: "paid", status: "active", note: "premium model" },
				{ label: "free · 90%", status: "active", note: "split" },
				{ label: "free · 10%", status: "fallback", note: "experiment" },
				{ label: "else", status: "idle", note: "default model" },
			],
			caption: "Change routing without a deploy",
		},
		benefits: [
			{ title: "Conditions", description: "Branch on headers, body or plan." },
			{ title: "Traffic splits", description: "A/B models by percentage." },
			{
				title: "Versions",
				description: "Every publish is versioned. Roll back anytime.",
			},
			{
				title: "Observable",
				description: "See which branch each request took.",
			},
		],
		useCases: [
			{
				title: "Tiered models",
				description: "Premium models for paying users",
			},
			{ title: "Safe rollouts", description: "Send 10% to a new model first" },
			{
				title: "No-redeploy changes",
				description: "Ops edits routing, code stays put",
			},
		],
		codeExample: {
			title: "Call a route by name",
			language: "bash",
			code: curl(
				"/v1/chat/completions",
				'{"model": "dynamic/support", "messages": [{"role": "user", "content": "Hello!"}]}',
				["x-user-tier: paid"],
			),
		},
	},
	{
		id: "sessions",
		slug: "sessions",
		title: "Sessions",
		subtitle: "Sticky routing for whole conversations",
		description:
			"Group related requests with an x-session-id header to keep provider routing sticky and trace a conversation end to end.",
		longDescription:
			"Send one header and every turn of a conversation stays on the same provider, keeping upstream prompt caches warm. The activity log groups the whole session for debugging.",
		icon: Fingerprint,
		category: "routing",
		docsPath: "/features/sessions",
		visual: {
			kind: "flow",
			source: "x-session-id",
			hub: "Sticky routing",
			targets: [
				{ label: "Turn 1", status: "active", note: "Provider B" },
				{ label: "Turn 2", status: "active", note: "Provider B" },
				{ label: "Turn 3", status: "active", note: "Provider B" },
			],
			caption: "Same provider, warm prompt cache",
		},
		benefits: [
			{ title: "One header", description: "Add x-session-id. Nothing else." },
			{
				title: "Warm caches",
				description: "Stay on the provider holding your cache.",
			},
			{
				title: "On by default",
				description: "Stickiness works out of the box.",
			},
			{
				title: "Session view",
				description: "Follow a conversation in the activity log.",
			},
		],
		useCases: [
			{
				title: "Coding agents",
				description: "Long tool loops stay cache-friendly",
			},
			{ title: "Chat apps", description: "Consistent behavior across turns" },
			{
				title: "Debugging",
				description: "Follow one user's whole conversation",
			},
		],
		codeExample: {
			title: "Tag a conversation",
			language: "bash",
			code: curl(
				"/v1/chat/completions",
				'{"model": "claude-sonnet-4-6", "messages": [{"role": "user", "content": "Hello!"}]}',
				["x-session-id: conversation-9f8e7d6c"],
			),
		},
	},
	{
		id: "service-tiers",
		slug: "service-tiers",
		title: "Service Tiers",
		subtitle: "Trade latency for cost, per request",
		description:
			"Pick Flex or Priority processing on supported OpenAI, Google, Fireworks and AWS Bedrock models with one service_tier parameter.",
		longDescription:
			"Flex runs at half the standard token price for work that can wait. Priority buys faster processing. Billing follows the tier the provider actually served.",
		icon: Gauge,
		category: "routing",
		docsPath: "/features/service-tiers",
		visual: {
			kind: "ranking",
			title: "service_tier · price multiplier",
			items: [
				{ label: "flex", value: 0.5, display: "0.5×", tone: "accent" },
				{ label: "default", value: 1, display: "1×", tone: "muted" },
				{
					label: "priority",
					value: 1,
					display: "per model",
					tone: "warn",
				},
			],
		},
		benefits: [
			{
				title: "Flex at 0.5×",
				description: "Half price for work that can wait.",
			},
			{
				title: "Priority lane",
				description: "Faster processing when it matters.",
			},
			{
				title: "Never downgraded",
				description: "Retries keep your requested tier.",
			},
			{
				title: "Fair billing",
				description: "Billed on the tier actually served.",
			},
		],
		useCases: [
			{ title: "Batch jobs", description: "Evals and backfills on Flex" },
			{ title: "User-facing paths", description: "Priority for live traffic" },
			{
				title: "Mixed workloads",
				description: "Choose per request, not per account",
			},
		],
		codeExample: {
			title: "Ask for priority",
			language: "bash",
			code: curl(
				"/v1/chat/completions",
				'{"model": "google-vertex/gemini-3.1-pro-preview", "service_tier": "priority", "messages": [{"role": "user", "content": "Summarize this report"}]}',
			),
		},
	},
	{
		id: "caching",
		slug: "caching",
		title: "Caching",
		subtitle: "Pay once for repeated work",
		description:
			"Serve identical requests from the gateway at $0, and use provider prompt caching to discount long, reused prompts.",
		longDescription:
			"Gateway caching answers repeated identical requests without calling the provider. Provider cache control discounts the shared prefix of long prompts like system prompts, tools and history.",
		icon: DatabaseZap,
		category: "routing",
		docsPath: "/features/caching",
		visual: {
			kind: "response",
			title: "usage · cached response",
			lines: [
				{ text: "{" },
				{ text: '  "usage": {' },
				{ text: '    "prompt_tokens": 12,' },
				{ text: '    "completion_tokens": 48,' },
				{ text: '    "cost": 0', highlight: true },
				{ text: "  }," },
				{ text: '  "metadata": { "cached": true }', highlight: true },
				{ text: "}" },
			],
			footer: "Repeated identical requests cost $0",
		},
		benefits: [
			{
				title: "$0 cache hits",
				description: "Identical requests never reach the provider.",
			},
			{
				title: "Prompt caching",
				description: "Discounted reuse of long prefixes.",
			},
			{
				title: "Configurable TTL",
				description: "Choose how long responses live.",
			},
			{
				title: "Visible savings",
				description: "Cached tokens shown in every response.",
			},
		],
		useCases: [
			{
				title: "Coding tools",
				description: "Huge system prompts, reused every call",
			},
			{
				title: "Test suites",
				description: "Re-run evals without paying twice",
			},
			{ title: "FAQ bots", description: "Common questions served instantly" },
		],
		codeExample: {
			title: "Mark a prefix for caching",
			language: "json",
			code: `{
	"model": "claude-sonnet-4-6",
	"messages": [
		{
			"role": "system",
			"content": [
				{
					"type": "text",
					"text": "<long system prompt>",
					"cache_control": { "type": "ephemeral" }
				}
			]
		},
		{ "role": "user", "content": "Review this diff" }
	]
}`,
		},
	},
	{
		id: "timeouts",
		slug: "timeouts",
		title: "Request Timeouts",
		subtitle: "Per-attempt limits that suit agents",
		description:
			"Per-attempt time limits that reset on every retry and never count your tool execution time.",
		longDescription:
			"Each upstream attempt gets a fresh window, including retries and fallbacks. Time your app spends running tools between calls never counts, so long agent runs keep going.",
		icon: Timer,
		category: "routing",
		docsPath: "/features/timeouts",
		visual: {
			kind: "flow",
			source: "Agent call",
			hub: "Per-attempt timer",
			targets: [
				{ label: "Attempt 1", status: "blocked", note: "limit reached" },
				{ label: "Attempt 2", status: "fallback", note: "fresh window" },
				{ label: "Tool run", status: "idle", note: "not counted" },
			],
			caption: "Every retry starts a new window",
		},
		benefits: [
			{
				title: "Per attempt",
				description: "Retries and fallbacks get fresh time.",
			},
			{ title: "Tools excluded", description: "Your tool time never counts." },
			{
				title: "Agent friendly",
				description: "Hours-long runs are unaffected.",
			},
			{
				title: "Tunable",
				description: "Lower per project, or set when self-hosting.",
			},
		],
		useCases: [
			{
				title: "Agent loops",
				description: "Many short calls over long sessions",
			},
			{ title: "Strict SLAs", description: "Cap slow attempts per project" },
			{ title: "Self-hosting", description: "Set limits with env variables" },
		],
	},
	{
		id: "custom-providers",
		slug: "custom-providers",
		title: "Custom Providers",
		subtitle: "Bring any OpenAI-compatible endpoint",
		description:
			"Plug private, self-hosted or niche OpenAI-compatible endpoints into the gateway and call them like any other model.",
		longDescription:
			"Register your own endpoint once and every team gets it behind the same API, keys, analytics and compliance checks as the built-in catalog.",
		icon: Puzzle,
		category: "routing",
		docsPath: "/features/custom-providers",
		enterprise: true,
		visual: {
			kind: "flow",
			source: "Your app",
			hub: "LLM Gateway",
			targets: [
				{ label: "mycompany/vllm", status: "active", note: "self-hosted" },
				{ label: "internal/tuned", status: "active", note: "private" },
				{ label: "openai/gpt-5", status: "idle", note: "catalog" },
			],
			caption: "Custom and catalog models, one API",
		},
		benefits: [
			{
				title: "Any compatible API",
				description: "If it speaks OpenAI, it plugs in.",
			},
			{
				title: "Custom catalog",
				description: "Define your own models in the directory.",
			},
			{
				title: "Same tooling",
				description: "Keys, logs and analytics included.",
			},
			{
				title: "Compliance aware",
				description: "Attest providers for your policy.",
			},
		],
		useCases: [
			{
				title: "Private deployments",
				description: "vLLM, TGI or in-house models",
			},
			{
				title: "Fine-tunes",
				description: "Serve them next to frontier models",
			},
			{ title: "Regional hosts", description: "Keep data in your own region" },
		],
		codeExample: {
			title: "Call your provider",
			language: "bash",
			code: curl(
				"/v1/chat/completions",
				'{"model": "mycompany/custom-gpt-4", "messages": [{"role": "user", "content": "Hello!"}]}',
			),
		},
	},
	{
		id: "image-generation",
		slug: "image-generation",
		title: "Image Generation",
		subtitle: "Every image model, one endpoint",
		description:
			"Generate and edit images through the OpenAI-compatible images API or conversationally through chat completions.",
		longDescription:
			"Call /v1/images/generations and /v1/images/edits with any supported image model, or generate images inside a chat. Same key, same billing, same logs.",
		icon: ImageIcon,
		category: "models",
		docsPath: "/features/image-generation",
		visual: {
			kind: "media",
			output: "image",
			prompt: "A cute cat wearing a tiny top hat",
			meta: "gemini-3-pro-image · 4 generations",
			sources: [
				"/features/cat-top-hat-1.webp",
				"/features/cat-top-hat-2.webp",
				"/features/cat-top-hat-3.webp",
				"/features/cat-top-hat-4.webp",
			],
		},
		benefits: [
			{ title: "OpenAI format", description: "Use the images API you know." },
			{ title: "Edits", description: "Change existing images with a prompt." },
			{ title: "In chat", description: "Generate images mid-conversation." },
			{
				title: "Many models",
				description: "Swap image models with one string.",
			},
		],
		useCases: [
			{ title: "Marketing assets", description: "Heroes, thumbnails and ads" },
			{ title: "Product mockups", description: "Iterate on visuals fast" },
			{ title: "In-app creation", description: "Let users generate images" },
		],
		codeExample: {
			title: "Generate an image",
			language: "bash",
			code: curl(
				"/v1/images/generations",
				'{"model": "gemini-3-pro-image", "prompt": "A cute cat wearing a tiny top hat", "size": "1024x1024"}',
			),
		},
	},
	{
		id: "video-generation",
		slug: "video-generation",
		title: "Video Generation",
		subtitle: "Async video jobs with signed callbacks",
		description:
			"Create videos with an OpenAI-compatible async API, then poll, download or receive a signed completion callback.",
		longDescription:
			"Submit a prompt and optional frames to /v1/videos, get a job id back, and let a signed callback tell you when the video is ready to download.",
		icon: Clapperboard,
		category: "models",
		docsPath: "/features/video-generation",
		visual: {
			kind: "media",
			output: "video",
			prompt: "A paper boat drifting at sunset",
			meta: "veo-3.1-fast-generate-preview · 6s · 1280×720",
			sources: ["/features/paper-boat-sunset.mp4"],
			poster: "/features/paper-boat-sunset-poster.webp",
		},
		benefits: [
			{ title: "Async jobs", description: "Submit, poll, download." },
			{
				title: "Signed callbacks",
				description: "Get notified when it's done.",
			},
			{ title: "Frame control", description: "Guide with reference frames." },
			{
				title: "OpenAI format",
				description: "Familiar request and job shapes.",
			},
		],
		useCases: [
			{ title: "Social clips", description: "Short videos from a prompt" },
			{ title: "Product motion", description: "Animate stills into scenes" },
			{ title: "Pipelines", description: "Batch generation with callbacks" },
		],
		codeExample: {
			title: "Start a video job",
			language: "bash",
			code: curl(
				"/v1/videos",
				'{"model": "veo-3.1-fast-generate-preview", "prompt": "A paper boat drifting at sunset", "seconds": 6, "size": "1280x720"}',
			),
		},
	},
	{
		id: "speech-generation",
		slug: "speech-generation",
		title: "Speech Generation",
		subtitle: "Text to natural speech",
		description:
			"Generate speech with ElevenLabs, Gemini, OpenAI and Qwen voices through the OpenAI-compatible audio API.",
		longDescription:
			"Send text to /v1/audio/speech, pick a model and voice, and get audio back, streamed or as a file, from several providers behind one API.",
		icon: AudioLines,
		category: "models",
		docsPath: "/features/speech-generation",
		visual: {
			kind: "audio",
			mode: "speech",
			title: "POST /v1/audio/speech",
			words: ["Hello,", "welcome", "to", "LLM", "Gateway!"],
			meta: "gemini-2.5-flash-preview-tts · voice Kore",
			src: "/features/welcome-speech.m4a",
			times: [
				[0.261, 0.482],
				[1.083, 1.485],
				[1.585, 1.665],
				[2.026, 2.548],
				[2.648, 3.09],
			],
		},
		benefits: [
			{
				title: "Four providers",
				description: "ElevenLabs, Gemini, OpenAI, Qwen.",
			},
			{ title: "Many voices", description: "Pick the voice per request." },
			{ title: "Streaming", description: "Start playback before it finishes." },
			{ title: "OpenAI format", description: "Works with the OpenAI SDK." },
		],
		useCases: [
			{ title: "Voice apps", description: "Read answers out loud" },
			{ title: "Narration", description: "Turn articles into audio" },
			{ title: "Accessibility", description: "Audio versions of any text" },
		],
		codeExample: {
			title: "Make it talk",
			language: "bash",
			code: `${curl(
				"/v1/audio/speech",
				'{"model": "gemini-2.5-flash-preview-tts", "input": "Hello, welcome to LLM Gateway!", "voice": "Kore"}',
			)} \\
  --output speech.wav`,
		},
	},
	{
		id: "transcription",
		slug: "transcription",
		title: "Transcription",
		subtitle: "Speech to text with word timestamps",
		description:
			"Transcribe audio into text with word-level timestamps through the audio transcriptions API.",
		longDescription:
			"Upload audio to /v1/audio/transcriptions and get the text, detected language, duration and a timestamp for every word.",
		icon: Captions,
		category: "models",
		docsPath: "/features/transcription",
		visual: {
			kind: "audio",
			mode: "transcription",
			title: "POST /v1/audio/transcriptions",
			words: ["Hello,", "welcome", "to", "LLM", "Gateway."],
			meta: "grok-stt-1-0 · 3.49s of audio",
			src: "/features/welcome-speech.m4a",
			times: [
				[0.261, 0.482],
				[1.083, 1.485],
				[1.585, 1.665],
				[2.026, 2.548],
				[2.648, 3.09],
			],
		},
		benefits: [
			{ title: "Word timestamps", description: "Start and end time per word." },
			{
				title: "Language detection",
				description: "Returned with every result.",
			},
			{ title: "Low cost", description: "Billed per hour of audio." },
			{ title: "One API key", description: "Same key as your chat calls." },
		],
		useCases: [
			{ title: "Captions", description: "Subtitles synced to the word" },
			{
				title: "Call notes",
				description: "Transcripts for meetings and calls",
			},
			{ title: "Voice input", description: "Turn speech into prompts" },
		],
		codeExample: {
			title: "Transcribe a file",
			language: "bash",
			code: `curl https://api.llmgateway.io/v1/audio/transcriptions \\
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \\
  -F model=grok-stt-1-0 \\
  -F file=@call.mp3`,
		},
	},
	{
		id: "realtime",
		slug: "realtime",
		title: "Realtime API",
		subtitle: "Speech-to-speech over WebSockets",
		description:
			"Low-latency voice conversations over the OpenAI-compatible /v1/realtime WebSocket endpoint.",
		longDescription:
			"Stream audio in and out with server-side voice activity detection, input transcription and function calling, using the same event protocol as the OpenAI Realtime API.",
		icon: Mic,
		category: "models",
		docsPath: "/features/realtime",
		visual: {
			kind: "audio",
			mode: "realtime",
			title: "wss://api.llmgateway.io/v1/realtime",
			words: [
				"Can you move my 3pm to tomorrow?",
				"Done. It's now tomorrow at 3pm.",
			],
			meta: "gpt-realtime · voice activity detection",
		},
		benefits: [
			{ title: "Low latency", description: "Audio streams both ways." },
			{ title: "Voice detection", description: "Server-side turn taking." },
			{ title: "Function calling", description: "Act mid-conversation." },
			{ title: "Browser safe", description: "Short-lived client secrets." },
		],
		useCases: [
			{ title: "Voice agents", description: "Support and booking lines" },
			{ title: "Live tutoring", description: "Natural back-and-forth" },
			{ title: "Hands-free apps", description: "Talk instead of type" },
		],
		codeExample: {
			title: "Open a session",
			language: "typescript",
			code: `import WebSocket from "ws";

const ws = new WebSocket(
	"wss://api.llmgateway.io/v1/realtime?model=gpt-realtime",
	{ headers: { Authorization: "Bearer " + process.env.LLM_GATEWAY_API_KEY } },
);

ws.on("message", (message) => console.log(JSON.parse(message.toString())));`,
		},
	},
	{
		id: "vision",
		slug: "vision",
		title: "Vision",
		subtitle: "Send images, get answers",
		description:
			"Send images to vision-enabled models as URLs or inline base64 data in the standard content array.",
		longDescription:
			"Mix text and images in one message. Pass a URL or a base64 data URL, add as many images as you need, and use any vision-enabled model.",
		icon: Eye,
		category: "models",
		docsPath: "/features/vision",
		visual: {
			kind: "document",
			mode: "vision",
			title: "image_url → gpt-4o",
			image: "/features/cat-top-hat-1.webp",
			output: [
				"# Cat Wearing a Top Hat",
				"",
				"- Seated on vintage chair",
				'- Book titled "Gentlecat\'s Guide"',
				"- Surrounded by indoor plants",
			],
		},
		benefits: [
			{ title: "URL or base64", description: "Whatever you have, send it." },
			{ title: "Multiple images", description: "Compare several in one call." },
			{ title: "Many models", description: "Every vision model works." },
			{ title: "Standard format", description: "OpenAI content array." },
		],
		useCases: [
			{ title: "Screenshot QA", description: "Explain or debug a UI" },
			{ title: "Receipts", description: "Pull totals from photos" },
			{ title: "Moderation", description: "Describe what users upload" },
		],
		codeExample: {
			title: "Ask about an image",
			language: "json",
			code: `{
	"model": "gpt-4o",
	"messages": [
		{
			"role": "user",
			"content": [
				{ "type": "text", "text": "What do you see?" },
				{ "type": "image_url", "image_url": { "url": "https://example.com/photo.jpg" } }
			]
		}
	]
}`,
		},
	},
	{
		id: "documents",
		slug: "documents",
		title: "Document Reading",
		subtitle: "Send PDFs straight to the model",
		description:
			"Send PDFs and other documents to document-capable models with OpenAI's file content block.",
		longDescription:
			"Attach a document as a data URL and the gateway forwards it to the provider so the model can read and reason over the whole file.",
		icon: FileText,
		category: "models",
		docsPath: "/features/documents",
		visual: {
			kind: "document",
			mode: "documents",
			title: "file → gemini-3.6-flash",
			output: [
				"# Summary",
				"",
				"Revenue up 18%,",
				"driven by enterprise.",
				"",
				"Risks: 2 · Actions: 4",
			],
		},
		benefits: [
			{ title: "Native PDFs", description: "No parsing step on your side." },
			{
				title: "Multiple files",
				description: "Several documents per message.",
			},
			{ title: "Standard block", description: "OpenAI file content format." },
			{ title: "Clear errors", description: "Unsupported types fail fast." },
		],
		useCases: [
			{ title: "Contract review", description: "Ask questions across clauses" },
			{ title: "Report summaries", description: "Long PDFs to short briefs" },
			{ title: "Data extraction", description: "Pull fields into JSON" },
		],
		codeExample: {
			title: "Attach a PDF",
			language: "json",
			code: `{
	"model": "gemini-3.6-flash",
	"messages": [
		{
			"role": "user",
			"content": [
				{ "type": "text", "text": "Summarize this report" },
				{
					"type": "file",
					"file": {
						"filename": "report.pdf",
						"file_data": "data:application/pdf;base64,..."
					}
				}
			]
		}
	]
}`,
		},
	},
	{
		id: "ocr",
		slug: "ocr",
		title: "OCR",
		subtitle: "Documents and images to markdown",
		description:
			"Extract text, tables and layout from PDFs and images as clean markdown, one entry per page, with the /v1/ocr endpoint.",
		longDescription:
			"Point /v1/ocr at a document or image and get structured markdown back for every page, ready for search, RAG or storage.",
		icon: FileScan,
		category: "models",
		docsPath: "/features/ocr",
		visual: {
			kind: "document",
			mode: "ocr",
			title: "POST /v1/ocr",
			output: [
				"# Invoice 2041",
				"",
				"| Item    | Qty | Total |",
				"| ------- | --- | ----- |",
				"| Hosting | 1   | 240   |",
				"| Support | 2   | 180   |",
			],
		},
		benefits: [
			{ title: "Markdown out", description: "Headings and tables preserved." },
			{ title: "Per page", description: "One clean entry per page." },
			{ title: "PDFs & images", description: "By URL or inline data." },
			{ title: "Dedicated endpoint", description: "Built for OCR models." },
		],
		useCases: [
			{ title: "RAG ingestion", description: "Index scanned documents" },
			{ title: "Invoices", description: "Tables to structured data" },
			{ title: "Archives", description: "Make old scans searchable" },
		],
		codeExample: {
			title: "Read a PDF",
			language: "bash",
			code: curl(
				"/v1/ocr",
				'{"model": "mistral-ocr-latest", "document": {"type": "document_url", "document_url": "https://arxiv.org/pdf/2201.04234"}}',
			),
		},
	},
	{
		id: "embeddings",
		slug: "embeddings",
		title: "Embeddings",
		subtitle: "Vectors for search and RAG",
		description:
			"Generate vector embeddings with OpenAI-compatible embedding models for semantic search, clustering and RAG.",
		longDescription:
			"Call /v1/embeddings with any supported model and get vectors back in the OpenAI format, ready for your vector database.",
		icon: Network,
		category: "models",
		docsPath: "/features/embeddings",
		visual: {
			kind: "vectors",
			query: "refund for a duplicate charge",
			clusters: ["Billing", "Shipping", "Account"],
		},
		benefits: [
			{ title: "OpenAI format", description: "Drop into existing pipelines." },
			{ title: "Many providers", description: "Pick the model per index." },
			{ title: "Batch input", description: "Embed many texts in one call." },
			{ title: "Tracked spend", description: "Costs in the same dashboard." },
		],
		useCases: [
			{
				title: "Semantic search",
				description: "Find by meaning, not keywords",
			},
			{ title: "RAG", description: "Retrieve the right context" },
			{ title: "Clustering", description: "Group similar tickets" },
		],
		codeExample: {
			title: "Embed text",
			language: "bash",
			code: curl(
				"/v1/embeddings",
				'{"model": "text-embedding-3-small", "input": "The quick brown fox jumps over the lazy dog."}',
			),
		},
	},
	{
		id: "rerank",
		slug: "rerank",
		title: "Rerank",
		subtitle: "Sharper retrieval in one call",
		description:
			"Reorder candidate documents by relevance to a query with the Cohere-compatible /v1/rerank endpoint.",
		longDescription:
			"Rerankers read the query and each document together, so they are far more accurate than vector similarity. Retrieve wide with embeddings, then rerank the top results.",
		icon: ListOrdered,
		category: "models",
		docsPath: "/features/rerank",
		visual: {
			kind: "ranking",
			title: "POST /v1/rerank",
			query: "What is the capital of France?",
			items: [
				{
					label: "Paris is the capital of France.",
					value: 0.98,
					display: "0.978",
				},
				{
					label: "France borders Spain and Italy.",
					value: 0.12,
					display: "0.121",
					tone: "muted",
				},
				{
					label: "Berlin is the capital of Germany.",
					value: 0.02,
					display: "0.0001",
					tone: "muted",
				},
			],
		},
		benefits: [
			{
				title: "Cross-encoder accuracy",
				description: "Query and document read together.",
			},
			{
				title: "Cohere compatible",
				description: "Same request and response shape.",
			},
			{ title: "Sorted results", description: "Highest relevance first." },
			{ title: "Two-stage ready", description: "Pairs with embeddings." },
		],
		useCases: [
			{
				title: "Better RAG",
				description: "Only the best passages reach the model",
			},
			{ title: "Search ranking", description: "Reorder keyword results" },
			{ title: "Answer selection", description: "Pick the best candidate" },
		],
		codeExample: {
			title: "Rerank candidates",
			language: "bash",
			code: curl(
				"/v1/rerank",
				'{"model": "qwen3-reranker-8b", "query": "What is the capital of France?", "documents": ["Paris is the capital of France.", "Berlin is the capital of Germany."]}',
			),
		},
	},
	{
		id: "search",
		slug: "search",
		title: "Search API",
		subtitle: "Ranked web results with page content",
		description:
			"Get ranked web results with extracted page content from the /v1/search endpoint.",
		longDescription:
			"Send a query, get back ranked results with the page content already extracted, filtered by recency if you want. Ideal grounding for agents.",
		icon: Search,
		category: "models",
		docsPath: "/features/search",
		visual: {
			kind: "ranking",
			title: "POST /v1/search",
			query: "latest developments in open-source LLMs",
			items: [
				{
					label: "Open-weight model tops coding benchmark",
					value: 0.94,
					display: "2d ago",
				},
				{
					label: "New MoE release cuts inference cost",
					value: 0.81,
					display: "4d ago",
				},
				{
					label: "Community fine-tunes pass 1M downloads",
					value: 0.66,
					display: "6d ago",
				},
			],
		},
		benefits: [
			{ title: "Content included", description: "Pages already extracted." },
			{
				title: "Recency filter",
				description: "Only fresh results if you want.",
			},
			{ title: "Ranked", description: "Most relevant first." },
			{ title: "One key", description: "No separate search vendor." },
		],
		useCases: [
			{ title: "Agent grounding", description: "Fresh facts before answering" },
			{ title: "Research tools", description: "Collect sources fast" },
			{ title: "News digests", description: "Weekly roundups" },
		],
		codeExample: {
			title: "Search the web",
			language: "bash",
			code: curl(
				"/v1/search",
				'{"query": "latest developments in open-source LLMs", "max_results": 3, "search_recency_filter": "week"}',
			),
		},
	},
	{
		id: "web-search",
		slug: "web-search",
		title: "Native Web Search",
		subtitle: "Live web answers with citations",
		description:
			"Give models real-time web access with a single web_search tool and get citations back with the answer.",
		longDescription:
			"Add the web_search tool to a chat request and supported models search the web, answer with up-to-date facts and return their sources.",
		icon: Globe,
		category: "models",
		docsPath: "/features/web-search",
		visual: {
			kind: "response",
			title: 'tools: [{ "type": "web_search" }]',
			lines: [
				{
					text: '"content": "It is 18°C and sunny in San Francisco.",',
					highlight: true,
				},
				{ text: '"annotations": [' },
				{ text: "  {" },
				{ text: '    "type": "url_citation",', highlight: true },
				{ text: '    "url_citation": {' },
				{
					text: '      "url": "https://weather.example.com/sf",',
					highlight: true,
				},
				{ text: '      "title": "San Francisco forecast"' },
				{ text: "    }" },
				{ text: "  }" },
				{ text: "]" },
			],
			footer: "Answer plus sources",
		},
		benefits: [
			{ title: "One tool", description: "Add web_search, done." },
			{ title: "Citations", description: "Sources returned with the answer." },
			{ title: "Streaming", description: "Works with streamed responses." },
			{ title: "SDK friendly", description: "Works with the OpenAI SDK." },
		],
		useCases: [
			{
				title: "Current events",
				description: "Answers past the training cutoff",
			},
			{ title: "Fact checking", description: "Show where facts come from" },
			{ title: "Live data", description: "Prices and weather in chat" },
		],
		codeExample: {
			title: "Turn on search",
			language: "bash",
			code: curl(
				"/v1/chat/completions",
				'{"model": "gpt-5.2", "messages": [{"role": "user", "content": "Weather in San Francisco?"}], "tools": [{"type": "web_search"}]}',
			),
		},
	},
	{
		id: "reasoning",
		slug: "reasoning",
		title: "Reasoning",
		subtitle: "Models that think before answering",
		description:
			"Use reasoning-capable models, control effort and token budgets, and stream the model's reasoning as it works.",
		longDescription:
			"Set reasoning_effort or a token budget on any reasoning model. The gateway normalizes it across providers and returns reasoning content and token usage.",
		icon: BrainCircuit,
		category: "models",
		docsPath: "/features/reasoning",
		visual: {
			kind: "response",
			title: 'reasoning_effort: "medium"',
			lines: [
				{ text: '"reasoning": "Common denominator is 12…', highlight: true },
				{ text: "  2/3 = 8/12, 1/4 = 3/12, 5/6 = 10/12", highlight: true },
				{ text: '  8 + 3 + 10 = 21 → 21/12 = 7/4"', highlight: true },
				{ text: "" },
				{ text: '"content": "The sum is 7/4 (1.75)."' },
				{ text: "" },
				{ text: '"usage": { "reasoning_tokens": 182 }' },
			],
			footer: "Same parameter on every provider",
		},
		benefits: [
			{ title: "Effort control", description: "Low, medium or high." },
			{ title: "Token budgets", description: "Cap thinking where supported." },
			{ title: "Streamed thoughts", description: "Watch reasoning arrive." },
			{ title: "Usage tracking", description: "Reasoning tokens reported." },
		],
		useCases: [
			{ title: "Math & logic", description: "Step-by-step problem solving" },
			{ title: "Code review", description: "Deeper analysis on hard diffs" },
			{ title: "Planning agents", description: "Think before acting" },
		],
		codeExample: {
			title: "Set the effort",
			language: "bash",
			code: curl(
				"/v1/chat/completions",
				'{"model": "gpt-oss-120b", "messages": [{"role": "user", "content": "What is 2/3 + 1/4 + 5/6?"}], "reasoning_effort": "medium"}',
			),
		},
	},
	{
		id: "decisions",
		slug: "decisions",
		title: "Decisions",
		subtitle: "Typed answers, not text",
		description:
			"Get typed, probabilistic decisions instead of generated text with the OpenAI-compatible /v1/decisions endpoint.",
		longDescription:
			"Define choice, yes/no and score questions. Decision models answer each with a typed value and a calibrated probability your code can branch on directly.",
		icon: Signpost,
		category: "models",
		docsPath: "/features/decisions",
		visual: {
			kind: "ranking",
			title: "POST /v1/decisions",
			query: "Help! My payouts have been failing for 3 days.",
			items: [
				{ label: "department = billing", value: 0.93, display: "93%" },
				{ label: "is_urgent = true", value: 0.88, display: "88%" },
				{
					label: "impact = Critical",
					value: 0.71,
					display: "71%",
					tone: "warn",
				},
			],
		},
		benefits: [
			{ title: "Typed output", description: "Choice, predicate or score." },
			{
				title: "Probabilities",
				description: "Calibrated confidence per answer.",
			},
			{ title: "No parsing", description: "Branch on values directly." },
			{ title: "Text or images", description: "Decide on either input." },
		],
		useCases: [
			{ title: "Ticket routing", description: "Send to the right team" },
			{ title: "Triage", description: "Flag urgent requests" },
			{ title: "Scoring", description: "Rate passages or leads" },
		],
		codeExample: {
			title: "Ask a typed question",
			language: "bash",
			code: curl(
				"/v1/decisions",
				'{"model": "gpt-6-luna-decisions", "input": "My payouts have been failing for 3 days.", "questions": [{"type": "predicate", "name": "is_urgent", "instructions": "Does this convey urgency?"}]}',
			),
		},
	},
	{
		id: "moderations",
		slug: "moderations",
		title: "Moderations",
		subtitle: "Classify unsafe text and images",
		description:
			"Classify unsafe text and image inputs with the OpenAI-compatible /v1/moderations API.",
		longDescription:
			"Check user input before it reaches your model. Get flagged categories and scores back in the OpenAI moderation format.",
		icon: ShieldAlert,
		category: "models",
		docsPath: "/features/moderations",
		visual: {
			kind: "ranking",
			title: "POST /v1/moderations",
			query: "I want to harm someone.",
			items: [
				{ label: "violence", value: 0.91, display: "flagged", tone: "warn" },
				{ label: "harassment", value: 0.34, display: "0.34", tone: "muted" },
				{ label: "self-harm", value: 0.03, display: "0.03", tone: "muted" },
			],
		},
		benefits: [
			{ title: "Text & images", description: "Multimodal safety checks." },
			{ title: "Category scores", description: "Know why it was flagged." },
			{ title: "OpenAI format", description: "Existing code just works." },
			{ title: "Pre-check", description: "Filter before the big model." },
		],
		useCases: [
			{ title: "UGC platforms", description: "Screen posts and uploads" },
			{ title: "Chat safety", description: "Check prompts before answering" },
			{ title: "Policy audits", description: "Score historical content" },
		],
		codeExample: {
			title: "Check an input",
			language: "bash",
			code: curl("/v1/moderations", '{"input": "I want to harm someone."}'),
		},
	},
	{
		id: "response-healing",
		slug: "response-healing",
		title: "Response Healing",
		subtitle: "Malformed JSON, repaired",
		description:
			"Automatically validate and repair malformed JSON responses from models when you ask for structured output.",
		longDescription:
			"Enable the response-healing plugin and the gateway fixes broken JSON, like markdown fences, trailing commas or cut-off objects, before it reaches your parser.",
		icon: Wrench,
		category: "models",
		docsPath: "/features/response-healing",
		visual: {
			kind: "heal",
			broken: [
				"Sure! Here is the JSON:",
				"```json",
				"{name: 'Ada',",
				'  "tags": ["math",',
			],
			fixed: ["{", '  "name": "Ada",', '  "tags": ["math"]', "}"],
		},
		benefits: [
			{ title: "One plugin", description: "Add response-healing, done." },
			{ title: "Common fixes", description: "Fences, commas, truncation." },
			{ title: "Healing metadata", description: "Know when a fix happened." },
			{ title: "JSON modes", description: "json_object and json_schema." },
		],
		useCases: [
			{ title: "Extraction", description: "Reliable structured data" },
			{ title: "Agents", description: "Outputs that always parse" },
			{ title: "Cheaper models", description: "Use them for JSON safely" },
		],
		codeExample: {
			title: "Turn it on",
			language: "bash",
			code: curl(
				"/v1/chat/completions",
				'{"model": "gpt-4o", "messages": [{"role": "user", "content": "Return name and age as JSON"}], "response_format": {"type": "json_object"}, "plugins": [{"id": "response-healing"}]}',
			),
		},
	},
	{
		id: "cost-breakdown",
		slug: "cost-breakdown",
		title: "Cost Breakdown",
		subtitle: "The price of every request, in the response",
		description:
			"Get real-time cost information for each request directly in the response's usage object.",
		longDescription:
			"Every response carries input, output and total cost, streaming included. Track spend per user or feature in code without querying the dashboard.",
		icon: Receipt,
		category: "observability",
		docsPath: "/features/cost-breakdown",
		visual: {
			kind: "response",
			title: "response.usage",
			lines: [
				{ text: '"usage": {' },
				{ text: '  "prompt_tokens": 1240,' },
				{ text: '  "completion_tokens": 312,' },
				{ text: '  "cost": 0.00467,', highlight: true },
				{ text: '  "cost_details": {' },
				{ text: '    "input_cost": 0.0031,', highlight: true },
				{ text: '    "output_cost": 0.00157,', highlight: true },
				{ text: '    "total_cost": 0.00467', highlight: true },
				{ text: "  }" },
				{ text: "}" },
			],
			footer: "Real cost, per request",
		},
		benefits: [
			{ title: "In every response", description: "No extra API call." },
			{ title: "Itemized", description: "Input, output and cache costs." },
			{
				title: "Streaming too",
				description: "Cost arrives with the last chunk.",
			},
			{ title: "Bill your users", description: "Exact cost per end user." },
		],
		useCases: [
			{ title: "Usage billing", description: "Charge customers what they use" },
			{ title: "Budget guards", description: "Stop runaway agents in code" },
			{ title: "Feature costing", description: "Know what each feature costs" },
		],
		codeExample: {
			title: "Read the cost",
			language: "typescript",
			code: `const completion = await client.chat.completions.create({
	model: "gpt-4o",
	messages: [{ role: "user", content: "Hello!" }],
});

console.log(completion.usage?.cost);`,
		},
	},
	{
		id: "metadata",
		slug: "metadata",
		title: "Request Metadata",
		subtitle: "Tag requests, filter later",
		description:
			"Attach user, country or any other context to requests with custom headers and filter your logs by it.",
		longDescription:
			"Send X-LLMGateway-* headers with any request. The values are stored with the log so you can find activity by user, session or anything else you tag.",
		icon: Tags,
		category: "observability",
		docsPath: "/features/metadata",
		visual: {
			kind: "response",
			title: "request headers",
			lines: [
				{ text: "POST /v1/chat/completions" },
				{ text: "Authorization: Bearer llmgtwy_••••" },
				{ text: "X-LLMGateway-User-ID: 9403f741", highlight: true },
				{ text: "X-LLMGateway-Country: US", highlight: true },
				{ text: "X-LLMGateway-Tenant: acme", highlight: true },
			],
			footer: "Filter the activity log by any value",
		},
		benefits: [
			{ title: "Just headers", description: "No body changes." },
			{ title: "Any key", description: "Users, tenants, versions." },
			{ title: "Filterable logs", description: "Find one user's requests." },
			{ title: "Multi-tenant", description: "Track usage per customer." },
		],
		useCases: [
			{ title: "Support", description: "Look up a user's history" },
			{ title: "Releases", description: "Compare app versions" },
			{ title: "SaaS tenants", description: "Usage per customer" },
		],
		codeExample: {
			title: "Add context",
			language: "bash",
			code: curl(
				"/v1/chat/completions",
				'{"model": "gpt-4o", "messages": [{"role": "user", "content": "Hello!"}]}',
				["X-LLMGateway-User-ID: 9403f741", "X-LLMGateway-Country: US"],
			),
		},
	},
	{
		id: "source",
		slug: "source",
		title: "Source Attribution",
		subtitle: "Get credit for your traffic",
		description:
			"Identify your domain with the X-Source header so your app appears in public usage statistics.",
		longDescription:
			"Add one header with your domain. Your app shows up in public statistics, and only the domain is shared.",
		icon: Radio,
		category: "observability",
		docsPath: "/features/source",
		visual: {
			kind: "ranking",
			title: "Top apps by tokens",
			items: [
				{ label: "your-app.com", value: 0.92, display: "1.2B" },
				{ label: "example.dev", value: 0.68, display: "880M", tone: "muted" },
				{ label: "acme.ai", value: 0.44, display: "570M", tone: "muted" },
			],
		},
		benefits: [
			{ title: "One header", description: "X-Source: your-domain.com" },
			{ title: "Public stats", description: "Show up where developers look." },
			{ title: "Privacy first", description: "Only the domain is shared." },
			{ title: "Optional", description: "Skip it and nothing changes." },
		],
		useCases: [
			{ title: "Visibility", description: "Get discovered by developers" },
			{ title: "Social proof", description: "Show real usage" },
			{ title: "Open source apps", description: "Attribute community traffic" },
		],
		codeExample: {
			title: "Set your source",
			language: "bash",
			code: curl(
				"/v1/chat/completions",
				'{"model": "gpt-4o", "messages": [{"role": "user", "content": "Hello!"}]}',
				["X-Source: example.com"],
			),
		},
	},
	{
		id: "data-retention",
		slug: "data-retention",
		title: "Data Retention",
		subtitle: "Keep metadata, or keep everything",
		description:
			"Choose metadata-only logging or full request and response retention for debugging, analytics and compliance.",
		longDescription:
			"Metadata-only retention is free and on by default. Enterprise teams can retain full payloads, including messages and tool calls, billed per token stored.",
		icon: LibraryBig,
		category: "observability",
		docsPath: "/features/data-retention",
		visual: {
			kind: "feed",
			title: "Organization · retention",
			items: [
				{ title: "Metadata only (default)", meta: "Free", tone: "ok" },
				{ title: "Retain all data", meta: "$0.01 / 1M tokens", tone: "info" },
				{
					title: "Messages, tool calls, attachments",
					meta: "Enterprise",
					tone: "info",
				},
				{ title: "Tokens, cost, latency, model", meta: "always", tone: "ok" },
			],
		},
		benefits: [
			{ title: "Free metadata", description: "Tokens, cost, latency, models." },
			{ title: "Full payloads", description: "Messages and tool calls kept." },
			{ title: "Per organization", description: "One setting for everyone." },
			{ title: "Cheap storage", description: "$0.01 per 1M tokens." },
		],
		useCases: [
			{ title: "Debugging", description: "See exactly what was sent" },
			{ title: "Audits", description: "Prove what the model saw" },
			{ title: "Evals", description: "Build datasets from real traffic" },
		],
	},
	{
		id: "data-streams",
		slug: "data-streams",
		title: "Data Streams",
		subtitle: "Logs to your SIEM and warehouse",
		description:
			"Forward audit logs to your SIEM and export request log metadata to your own HTTPS endpoint as signed batches.",
		longDescription:
			"Data streams send signed, ordered batches to an endpoint you run. The cursor only advances when you accept a batch, and you can replay.",
		icon: Layers,
		category: "observability",
		docsPath: "/features/data-streams",
		enterprise: true,
		visual: {
			kind: "feed",
			title: "POST https://siem.example.com/llm",
			items: [
				{ title: "audit · api key created", meta: "batch 418", tone: "info" },
				{
					title: "log · gpt-5 · 1,240 tokens",
					meta: "batch 419",
					tone: "info",
				},
				{ title: "Signature verified", meta: "HMAC-SHA256", tone: "ok" },
				{ title: "200 OK · cursor advanced", meta: "500 events", tone: "ok" },
			],
		},
		benefits: [
			{
				title: "SIEM forwarding",
				description: "Every admin action, streamed.",
			},
			{ title: "Log export", description: "Model, tokens, cost, latency." },
			{ title: "Signed batches", description: "HMAC-SHA256 on every POST." },
			{ title: "Replay", description: "Resend events when you need to." },
		],
		useCases: [
			{ title: "Security teams", description: "AI activity in your SIEM" },
			{ title: "Data warehouse", description: "Join usage with product data" },
			{ title: "Compliance", description: "Long-term audit trails" },
		],
	},
	{
		id: "notifications",
		slug: "notifications",
		title: "Notifications",
		subtitle: "Know before it breaks",
		description:
			"Get in-app and email alerts for budgets, model retirements, provider issues, compliance changes and organization limits.",
		longDescription:
			"Choose in-app, email or both for each alert type. Hear about budget thresholds, retiring models and provider errors before your users do.",
		icon: Bell,
		category: "observability",
		docsPath: "/features/notifications",
		visual: {
			kind: "feed",
			title: "Notifications",
			items: [
				{ title: "API key reached 80% of budget", meta: "now", tone: "warn" },
				{ title: "A model you use retires soon", meta: "2m", tone: "info" },
				{ title: "Elevated errors on a provider", meta: "8m", tone: "error" },
				{ title: "New model allowed by policy", meta: "1h", tone: "ok" },
			],
		},
		benefits: [
			{
				title: "Budget alerts",
				description: "Default at 80% of a key budget.",
			},
			{
				title: "Retirement notice",
				description: "Up to 30 days before a model goes.",
			},
			{ title: "Provider health", description: "Errors on providers you use." },
			{ title: "Your channels", description: "In-app, email or both." },
		],
		useCases: [
			{ title: "Cost control", description: "Catch overspend early" },
			{ title: "Migrations", description: "Move off retiring models in time" },
			{ title: "Compliance", description: "Hear about policy changes" },
		],
	},
	{
		id: "compliance",
		slug: "compliance",
		title: "Compliance Policies",
		subtitle: "Only route to providers you trust",
		description:
			"Restrict routing to providers that meet your requirements, like ZDR, SOC 2, ISO 27001, GDPR and no prompt training.",
		longDescription:
			"Set the certifications and data policies you need. Requests that would reach a non-compliant provider are blocked before any data leaves the gateway.",
		icon: ShieldCheck,
		category: "security",
		docsPath: "/features/compliance",
		enterprise: true,
		visual: {
			kind: "flow",
			source: "Request",
			hub: "Policy check",
			targets: [
				{ label: "Provider A", status: "active", note: "SOC 2 · ZDR" },
				{ label: "Provider B", status: "active", note: "ISO 27001 · GDPR" },
				{ label: "Provider C", status: "blocked", note: "trains on prompts" },
			],
			caption: "Blocked before data leaves the gateway",
		},
		benefits: [
			{ title: "Certifications", description: "SOC 2, ISO 27001, GDPR." },
			{ title: "Data policies", description: "ZDR and no prompt training." },
			{
				title: "Hard enforcement",
				description: "Blocked before any data leaves.",
			},
			{ title: "Alerts", description: "Know when eligibility changes." },
		],
		useCases: [
			{ title: "Regulated industries", description: "Finance, health, legal" },
			{ title: "EU customers", description: "GDPR-ready routing" },
			{ title: "Security reviews", description: "One policy to point at" },
		],
	},
	{
		id: "sso",
		slug: "sso",
		title: "SSO & SCIM",
		subtitle: "Your identity provider, your rules",
		description:
			"Per-organization SAML single sign-on and SCIM directory provisioning with Okta, Microsoft Entra ID, Google or any SAML 2.0 IdP.",
		longDescription:
			"Members sign in with your identity provider, routed by email domain. SCIM keeps the member list in sync, and you can enforce SSO once everyone is set up.",
		icon: KeyRound,
		category: "security",
		docsPath: "/features/sso",
		enterprise: true,
		visual: {
			kind: "flow",
			source: "Okta · Entra",
			hub: "SAML + SCIM",
			targets: [
				{ label: "Sign in", status: "active", note: "by email domain" },
				{ label: "Provision", status: "active", note: "SCIM sync" },
				{ label: "Password login", status: "blocked", note: "SSO enforced" },
			],
			caption: "One identity, every member",
		},
		benefits: [
			{ title: "SAML SSO", description: "Okta, Entra, Google, any SAML 2.0." },
			{ title: "SCIM", description: "Members added and removed for you." },
			{ title: "Domain routing", description: "Users land on the right IdP." },
			{ title: "Enforcement", description: "Require SSO when you're ready." },
		],
		useCases: [
			{ title: "Onboarding", description: "New hires get access day one" },
			{ title: "Offboarding", description: "Access removed automatically" },
			{
				title: "Security policy",
				description: "Central identity for AI tools",
			},
		],
	},
	{
		id: "project-access",
		slug: "project-access",
		title: "Project Access",
		subtitle: "Delegate projects, not the org",
		description:
			"Let someone administer specific projects without granting organization-wide access.",
		longDescription:
			"Assign the Project admin role with grants to the projects a person owns. They manage those projects without organization administration rights.",
		icon: UserCog,
		category: "security",
		docsPath: "/features/project-access",
		enterprise: true,
		visual: {
			kind: "tree",
			root: "Acme organization",
			branches: [
				{
					label: "Support bot",
					badge: "project admin",
					children: ["keys", "settings", "logs"],
				},
				{ label: "Search", badge: "developer", children: ["logs", "usage"] },
				{
					label: "Organization",
					badge: "owners only",
					children: ["billing", "projects"],
				},
			],
		},
		benefits: [
			{ title: "Scoped admins", description: "Only the projects you grant." },
			{ title: "Least privilege", description: "No org-wide powers." },
			{
				title: "Works with SSO",
				description: "Teams and budgets still apply.",
			},
			{ title: "API ready", description: "Assign roles programmatically." },
		],
		useCases: [
			{ title: "Team leads", description: "Own their team's project" },
			{ title: "Agencies", description: "Client projects kept apart" },
			{ title: "Large orgs", description: "Delegate without risk" },
		],
		codeExample: {
			title: "Grant project admin",
			language: "json",
			code: `{
	"email": "member@example.com",
	"role": "project_admin",
	"projectIds": ["your-project-id"]
}`,
		},
	},
	{
		id: "master-keys",
		slug: "master-keys",
		title: "Master Keys",
		subtitle: "Provision everything from your backend",
		description:
			"Create projects, API keys, IAM rules and custom providers programmatically, and pull per-member usage and cost.",
		longDescription:
			"Master keys are org-scoped tokens for server-to-server provisioning. Onboard tenants from your own backend and report usage without opening the dashboard.",
		icon: Building2,
		category: "security",
		docsPath: "/features/master-keys",
		enterprise: true,
		visual: {
			kind: "flow",
			source: "Your backend",
			hub: "Master key",
			targets: [
				{ label: "Projects", status: "active", note: "create" },
				{ label: "API keys", status: "active", note: "issue + limit" },
				{ label: "IAM rules", status: "active", note: "per key, member" },
				{ label: "Usage report", status: "active", note: "per member" },
			],
			caption: "Multi-tenant onboarding in code",
		},
		benefits: [
			{ title: "Org scoped", description: "One token for provisioning." },
			{
				title: "Full control",
				description: "Projects, keys, providers, models.",
			},
			{ title: "IAM rules", description: "Limit what each key can call." },
			{ title: "Usage & cost", description: "Per-member reporting." },
		],
		useCases: [
			{ title: "SaaS onboarding", description: "A project per new customer" },
			{ title: "Internal platforms", description: "Self-serve keys for teams" },
			{ title: "Chargeback", description: "Cost per member or team" },
		],
		codeExample: {
			title: "List projects",
			language: "bash",
			code: `curl https://internal.llmgateway.io/v1/master/projects \\
  -H "Authorization: Bearer $MASTER_KEY"`,
		},
	},
	{
		id: "models-directory",
		slug: "models-directory",
		title: "Org Models Directory",
		subtitle: "Every model your team can call",
		description:
			"One directory of every catalog and custom model your organization can use, with per-model compliance eligibility.",
		longDescription:
			"Search the full catalog plus your custom models in one place, and see at a glance which ones your compliance policy allows.",
		icon: BookOpenText,
		category: "security",
		docsPath: "/features/models-directory",
		visual: {
			kind: "feed",
			title: "Organization → Models",
			items: [
				{ title: "claude-sonnet-4-6", meta: "eligible", tone: "ok" },
				{
					title: "internal-vllm/llama-4-maverick",
					meta: "custom",
					tone: "info",
				},
				{ title: "gpt-5", meta: "eligible", tone: "ok" },
				{ title: "deepseek-v3.2", meta: "blocked by policy", tone: "error" },
			],
		},
		benefits: [
			{ title: "One list", description: "Catalog and custom models together." },
			{ title: "Eligibility", description: "Policy status per model." },
			{ title: "Filters", description: "Capability, provider, price." },
			{ title: "API discovery", description: "List models with a key." },
		],
		useCases: [
			{ title: "Developer self-serve", description: "Know what you may use" },
			{ title: "Policy reviews", description: "See what the policy allows" },
			{ title: "Cost planning", description: "Compare prices quickly" },
		],
	},
	{
		id: "organization-skills",
		slug: "organization-skills",
		title: "Organization Skills",
		subtitle: "Share agent skills across your team",
		description:
			"Publish shared skills and custom instructions that developers in your organization pull through the CLI.",
		longDescription:
			"Owners and admins import SKILL.md files or folders in the dashboard. Developers discover and download them with a project API key, so every agent follows the same playbook.",
		icon: ScrollText,
		category: "build",
		docsPath: "/features/organization-skills",
		enterprise: true,
		visual: {
			kind: "tree",
			root: "Organization skills",
			branches: [
				{
					label: "code-review",
					badge: "all devs",
					children: ["SKILL.md", "checklist.md"],
				},
				{
					label: "release",
					badge: "platform",
					children: ["SKILL.md", "scripts/"],
				},
				{ label: "security", badge: "all devs", children: ["SKILL.md"] },
			],
		},
		benefits: [
			{ title: "Import fast", description: "A SKILL.md or a whole folder." },
			{ title: "Access control", description: "Choose who sees each skill." },
			{ title: "CLI delivery", description: "Pulled with a project key." },
			{
				title: "One standard",
				description: "Same instructions for every agent.",
			},
		],
		useCases: [
			{ title: "Code standards", description: "Reviews that match your rules" },
			{ title: "Runbooks", description: "Release and on-call playbooks" },
			{ title: "Onboarding", description: "New devs get team know-how" },
		],
		codeExample: {
			title: "A shared skill",
			language: "markdown",
			code: `---
name: code-review
description: Review code changes against the team's standards.
---

# Code review

- Check correctness and error handling.
- Explain the impact of each finding.
- Suggest tests for important edge cases.`,
		},
	},
	{
		id: "prompt-management",
		slug: "prompt-management",
		title: "Prompt Management",
		subtitle: "Ship prompt changes without a deploy",
		description:
			"Store versioned prompt templates in LLM Gateway and reference them from requests with labels like production and staging.",
		longDescription:
			"Every prompt has immutable versions. Move the production label to a new version and every request using it picks up the change, no redeploy.",
		icon: NotebookPen,
		category: "build",
		docsPath: "/features/prompt-management",
		visual: {
			kind: "versions",
			name: "@prompt/support-reply",
			versions: [
				{ id: "v1", note: "First draft" },
				{ id: "v2", note: "Shorter tone" },
				{ id: "v3", note: "Adds refunds" },
				{ id: "v4", note: "Handles escalations" },
			],
			labels: [{ name: "production", from: 2, to: 3 }],
		},
		benefits: [
			{ title: "Immutable versions", description: "Every edit is kept." },
			{ title: "Labels", description: "production, staging, your own." },
			{ title: "Variables", description: "Templates filled at request time." },
			{ title: "Instant rollback", description: "Move the label back." },
		],
		useCases: [
			{ title: "Prompt iteration", description: "Tune without redeploys" },
			{ title: "Staged rollout", description: "Test in staging first" },
			{ title: "Team edits", description: "Non-engineers own the copy" },
		],
		codeExample: {
			title: "Use a prompt",
			language: "bash",
			code: curl(
				"/v1/chat/completions",
				'{"model": "@prompt/support-reply", "messages": [{"role": "user", "content": "How do I rotate my key?"}]}',
			),
		},
	},
	{
		id: "embeddable-payments",
		slug: "embeddable-payments",
		title: "Embeddable Payments",
		subtitle: "Your users pay for AI, you keep the margin",
		description:
			"Embed end-user wallets and credit purchases in your app with the Payments SDK, billed through LLM Gateway with your markup.",
		longDescription:
			"Your users get their own wallet, buy credits inside your app and pay per request. LLM Gateway is the merchant of record and your markup is your margin.",
		icon: Coins,
		category: "build",
		docsPath: "/features/embeddable-payments",
		visual: {
			kind: "checkout",
			brand: "your-app",
			balance: "$24.80",
			packs: ["$10", "$25", "$50"],
			charges: [
				"− $0.0042 · gpt-5",
				"− $0.0011 · gemini-3-flash",
				"− $0.0087 · claude-sonnet",
				"− $0.0006 · embeddings",
			],
			margin: 22,
		},
		benefits: [
			{
				title: "User wallets",
				description: "Each user funds their own usage.",
			},
			{ title: "Drop-in UI", description: "React components or headless." },
			{ title: "Your markup", description: "Set it once, keep the margin." },
			{
				title: "No payments ops",
				description: "We're the merchant of record.",
			},
		],
		useCases: [
			{ title: "AI SaaS", description: "Usage-based pricing out of the box" },
			{ title: "Marketplaces", description: "Users bring their own budget" },
			{ title: "Indie apps", description: "Monetize from day one" },
		],
		codeExample: {
			title: "Install the SDK",
			language: "bash",
			code: `# backend
npm install @llmgateway/server
# frontend (pick one)
npm install @llmgateway/elements   # React drop-in components
npm install @llmgateway/client     # headless / non-React`,
		},
	},
];
