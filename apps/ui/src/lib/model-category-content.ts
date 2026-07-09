export interface ModelCategoryFaq {
	question: string;
	answer: string;
}

export interface ModelCategoryContent {
	metaTitle: string;
	metaDescription: string;
	heading: string;
	subheading: string;
	intro: string[];
	faqs: ModelCategoryFaq[];
}

export const modelCategoryContent = {
	roleplay: {
		metaTitle: "Best AI Models for Roleplay — Compare Roleplay LLMs",
		metaDescription:
			"Compare the best LLMs for roleplay and character chat — DeepSeek, Kimi K2, GLM, Claude, and more. See context windows and per-token pricing, and use any of them with one API key.",
		heading: "Best Models for Roleplay",
		subheading:
			"Models with strong character consistency, creative prose, and long context windows — compared by price and context size",
		intro: [
			"A good roleplay model needs three things: prose that stays in character over hundreds of messages, a context window large enough to hold character cards and long chat histories, and per-token pricing that doesn't punish long sessions. This page lists the models the roleplay community actually uses — from budget favorites like DeepSeek and GLM to premium options like Claude — with live pricing and context sizes for every provider.",
			"Every model here is available through the same OpenAI-compatible endpoint, so you can plug LLM Gateway into SillyTavern, RisuAI, or your own frontend with one API key, switch models mid-conversation, and fall back automatically when a provider has an outage.",
		],
		faqs: [
			{
				question: "What is the best AI model for roleplay?",
				answer:
					"It depends on your budget. DeepSeek V4 and GLM-5 are the best value for money and rarely break character, Kimi K2.6 is known for expressive creative prose, and Claude Opus 4.8 and Claude Sonnet 5 write the highest-quality prose if you're willing to pay premium per-token rates. Grok's non-reasoning models are a popular fast middle ground.",
			},
			{
				question: "Can I use these models with SillyTavern or my own frontend?",
				answer:
					"Yes. LLM Gateway exposes an OpenAI-compatible chat completions API, so any frontend that supports a custom base URL — SillyTavern, RisuAI, Agnai, or your own app — works by pointing it at the gateway and using your LLM Gateway API key.",
			},
			{
				question: "Which roleplay models have the largest context windows?",
				answer:
					"Grok 4.1 Fast supports up to 2 million tokens, and Claude Sonnet 5, GLM-5.2, DeepSeek V4, and MiniMax Text-01 all reach 1 million tokens. That's enough to keep an entire long-running roleplay, including character cards and lorebooks, in context.",
			},
			{
				question: "How much does API roleplay cost compared to a subscription?",
				answer:
					"Usually less. A typical roleplay exchange runs a few thousand tokens, so on a model like DeepSeek V4 Flash (about $0.14 per million input tokens) even heavy daily use costs a fraction of a fixed chatbot subscription — and you only pay for what you use.",
			},
		],
	},
	coding: {
		metaTitle: "Best LLMs for Coding — Compare AI Coding Models",
		metaDescription:
			"Compare the best AI models for coding — Claude Sonnet 5, GPT-5.3 Codex, Gemini 3.1 Pro, Qwen3 Coder, Kimi K2.7 Code, and DeepSeek V4 — by price, context window, and capabilities.",
		heading: "Best Models for Coding",
		subheading:
			"Frontier and open-weight models for code generation, review, and agentic coding — compared by price and context window",
		intro: [
			"The best coding models combine strong code generation with reliable tool calling, since modern coding agents lean on function calls to edit files and run commands. This page tracks the models developers actually ship with: Anthropic's Claude series, OpenAI's Codex line, Google's Gemini Pro, and fast-improving open-weight options like Qwen3 Coder, Kimi K2.7 Code, GLM, and DeepSeek.",
			"Access every one of them through a single OpenAI-compatible API with automatic failover, so your coding agent, IDE plugin, or CI pipeline can switch between frontier and budget models without code changes — and you can track exactly what each tool spends.",
		],
		faqs: [
			{
				question: "What is the best LLM for coding?",
				answer:
					"Claude Sonnet 5 and Claude Opus 4.8 lead most real-world coding evaluations, with OpenAI's GPT-5.3 Codex and Google's Gemini 3.1 Pro close behind. Among open-weight models, Qwen3 Coder, Kimi K2.7 Code, GLM-5.2, and DeepSeek V4 deliver strong results at a fraction of the price.",
			},
			{
				question: "What is the cheapest model that is still good at coding?",
				answer:
					"Qwen3 Coder 30B (about $0.07 per million input tokens), GLM-4.7 Flash, and DeepSeek V4 Flash are the standouts for budget coding. They handle everyday completion, refactoring, and code review well and are cheap enough to run on every commit.",
			},
			{
				question:
					"Can I use these models with coding agents like Cline or Aider?",
				answer:
					"Yes. Any agent that supports an OpenAI-compatible endpoint or custom base URL can route through LLM Gateway with one API key — that includes Cline, Aider, Roo Code, and devpass-code — so you can mix models per task and see per-agent cost analytics.",
			},
			{
				question: "Do coding models need tool calling?",
				answer:
					"For agentic workflows, yes. Editing files, running tests, and searching a repo all happen through function calls, so pick a model with reliable tool calling — the capability icons in the list above show which provider mappings support tools. For plain autocomplete or one-shot generation, tool calling is optional.",
			},
		],
	},
	"creative-writing": {
		metaTitle: "Best AI Models for Creative Writing — Compare LLMs",
		metaDescription:
			"Compare the best LLMs for creative writing and fiction — Kimi K2, Claude Opus, GPT-5.5, Gemini Pro, and more — by prose quality, context window, and price.",
		heading: "Best Models for Creative Writing",
		subheading:
			"Models with strong long-form prose, style control, and narrative consistency — compared by price and context window",
		intro: [
			"Creative writing stresses different muscles than coding or Q&A: voice, pacing, imagery, and the ability to hold a narrative together across an entire draft. Benchmark leaderboards rarely capture this, but a few models are consistently praised by writers — Moonshot's Kimi K2 line for expressive prose, Claude Opus and Sonnet for controlled literary style, and GPT-5.5 and Gemini Pro for versatile long-form drafting.",
			"Use them side by side through one API to find the voice that fits your project: draft with a budget open-weight model like DeepSeek or GLM, then do a polish pass with a frontier model — without juggling multiple provider accounts.",
		],
		faqs: [
			{
				question: "What is the best AI model for creative writing?",
				answer:
					"Kimi K2.5 and K2.6 have a strong reputation for vivid, natural prose, while Claude Opus 4.8 is favored for literary control and revision work. GPT-5.5 and Gemini 3.1 Pro are dependable all-rounders, and DeepSeek V4 is the best budget option for high-volume drafting.",
			},
			{
				question: "Which model is best for writing a novel?",
				answer:
					"Pick one with a context window that holds your whole manuscript: 200K tokens is roughly 150,000 words, and million-token models like Claude Sonnet 5, GLM-5.2, and DeepSeek V4 can keep an entire draft plus outline and notes in context, which keeps characters and plot threads consistent across chapters.",
			},
			{
				question: "How do I make AI writing sound less generic?",
				answer:
					"Model choice matters most — the models on this page were picked for distinctive prose. Beyond that, give the model reference passages in the voice you want, raise temperature slightly for ideation and lower it for revision, and iterate in short passes instead of asking for the full text at once.",
			},
			{
				question: "How much does drafting with these models cost?",
				answer:
					"A full 100,000-word draft is roughly 130,000 output tokens. On DeepSeek V4 Flash that costs a few cents; on a frontier model like Claude Opus 4.8 (at $25 per million output tokens) the same draft pass is a few dollars. Compare output prices in the list above to budget your workflow.",
			},
		],
	},
	translation: {
		metaTitle: "Best LLMs for Translation — Multilingual AI Models",
		metaDescription:
			"Compare the best AI models for translation — Gemini, GPT-5.4, Claude, Qwen, and DeepSeek — with strong multilingual coverage, long-document support, and per-token pricing.",
		heading: "Best Models for Translation",
		subheading:
			"Multilingual models with strong translation quality across major and low-resource languages — compared by price and context",
		intro: [
			"Modern LLMs now rival dedicated translation engines for most language pairs — and beat them on context awareness, tone, terminology consistency, and formatting. The strongest multilingual models are Google's Gemini line, OpenAI's GPT-5.4, Anthropic's Claude, and Alibaba's Qwen, which is particularly strong on Chinese and other Asian languages.",
			"Long context windows also change how translation work gets done: instead of translating strings in isolation, you can put an entire document plus a glossary into one prompt and keep terminology consistent throughout. For bulk workloads, budget models like Gemini Flash-Lite and DeepSeek V4 Flash bring the cost per translated word down to fractions of a cent.",
		],
		faqs: [
			{
				question: "What is the best LLM for translation?",
				answer:
					"Gemini 3.1 Pro and GPT-5.4 deliver the most consistent quality across a broad set of language pairs. Qwen3.7 Max is a top pick for Chinese, Japanese, and Korean, and Claude Sonnet 5 excels when tone and nuance matter. For bulk work, Gemini 2.5 Flash-Lite and DeepSeek V4 Flash offer the best cost per word.",
			},
			{
				question: "Are LLMs better than Google Translate or DeepL?",
				answer:
					"For most content, yes — LLMs follow style guides, preserve formatting and placeholders, keep terminology consistent across a document, and adapt register on request. Dedicated engines still win on raw speed and per-character price for very simple, high-volume strings.",
			},
			{
				question: "How do I translate long documents?",
				answer:
					"Use a long-context model and send the whole document in one call: a million-token window fits roughly 750,000 words, and single-call translation keeps names and terminology consistent. If a document exceeds the window, chunk it and include a running glossary in each prompt.",
			},
			{
				question: "Which models handle low-resource languages best?",
				answer:
					"Coverage drops for languages with little training data. Gemini Pro and GPT-5.4 generally hold up best, but always test with your actual language pair before committing volume — with one API key you can run the same text through several models in minutes and compare.",
			},
		],
	},
	math: {
		metaTitle: "Best LLMs for Math — Compare AI Reasoning Models",
		metaDescription:
			"Compare the best AI models for math and quantitative reasoning — GPT-5.5 Pro, Claude Opus, DeepSeek V4, Gemini Pro, and Qwen thinking models — by accuracy, price, and reasoning support.",
		heading: "Best Models for Math",
		subheading:
			"Reasoning models for competition math, quantitative analysis, and step-by-step problem solving",
		intro: [
			"Math is where reasoning models earn their keep: spending thinking tokens before answering dramatically improves accuracy on competition problems, proofs, and multi-step quantitative work. The strongest options are OpenAI's Pro-tier models, Claude Opus, and Gemini Pro — and, at a much lower price, open-weight reasoners like DeepSeek V4, Qwen's thinking models, and Xiaomi's MiMo.",
			"All of them are available through the same API here, so you can tune thinking budgets, compare answers across models, and route easy problems to cheap models while sending the hard ones to a Pro tier.",
		],
		faqs: [
			{
				question: "What is the best LLM for math?",
				answer:
					"GPT-5.5 Pro and GPT-5.4 Pro top most math evaluations, with Claude Opus 4.8 and Gemini 3.1 Pro close behind. DeepSeek V4 Pro and Qwen's 235B thinking model get remarkably close at a fraction of the cost, which makes them the default choice for high-volume math workloads.",
			},
			{
				question: "Do I need a reasoning model for math?",
				answer:
					"For anything beyond arithmetic and simple algebra, yes. Reasoning models work through problems step by step before answering and are far more reliable on competition-style and multi-step problems. Most models here let you cap the thinking budget so you control cost per problem.",
			},
			{
				question: "Can LLMs be trusted for calculations?",
				answer:
					"Not blindly. Models still make arithmetic slips inside otherwise-correct reasoning, so for production use pair the model with tool calling — let it call a calculator or run code — and use the LLM for setting up and interpreting the math rather than raw number crunching.",
			},
			{
				question: "How much do reasoning tokens cost?",
				answer:
					"Reasoning tokens bill as output tokens, and hard problems can burn thousands of them. That's why per-token price matters double for math: DeepSeek V4 Pro at $0.87 per million output tokens can be orders of magnitude cheaper per problem than a Pro-tier frontier model — compare output prices in the list above.",
			},
		],
	},
	"long-context": {
		metaTitle: "Long Context LLMs — Models With 200K+ Token Windows",
		metaDescription:
			"Compare LLMs with 200K to 2M token context windows — Grok, Gemini, Claude, GPT-5, DeepSeek, and more. Fit whole codebases and document sets in a single prompt.",
		heading: "Long Context Models",
		subheading:
			"Models with context windows of 200K tokens or more — up to 2M — for whole-codebase and multi-document workloads",
		intro: [
			"Every model on this page accepts at least 200,000 tokens of context — roughly 150,000 words — and the largest stretch much further: Grok 4.1 Fast at 2 million tokens, with Gemini, Claude Sonnet 5, GPT-5.4, DeepSeek V4, and GLM-5.2 at or above the million-token mark. That's enough to fit an entire codebase, a legal document set, or months of chat history into a single prompt.",
			"Advertised size isn't everything: retrieval quality can degrade well before the window is full, and long prompts get expensive fast. Cached input pricing — shown in the list — matters more than the headline price when you re-send large contexts on every request.",
		],
		faqs: [
			{
				question: "Which LLM has the largest context window?",
				answer:
					"Grok 4.1 Fast currently leads with a 2 million token window. Gemini models run just over 1 million, and Claude Sonnet 5, GPT-5.4, DeepSeek V4, GLM-5.2, and Qwen3.7 also offer million-token windows.",
			},
			{
				question: "How many words fit in a 200K context window?",
				answer:
					"Roughly 150,000 English words — about 600 pages. A million-token window fits around 750,000 words: several full-length books, or a mid-sized codebase.",
			},
			{
				question: "Do models actually use the full window well?",
				answer:
					"Not uniformly. Most models recall the start and end of a prompt better than the middle, and effective context is often smaller than the advertised maximum. For critical retrieval over huge inputs, test with your own data and consider chunking plus retrieval instead of one giant prompt.",
			},
			{
				question: "How do I keep long-context costs down?",
				answer:
					"Use cached input pricing: providers charge a fraction of the normal rate for re-sent, unchanged prefixes, which is exactly the shape of chatting over a large document or codebase. Structure prompts so the big static context comes first and only the question changes.",
			},
		],
	},
	cheapest: {
		metaTitle: "Cheapest LLM APIs — Compare Low-Cost AI Models",
		metaDescription:
			"Compare the cheapest LLM APIs — models at or under $0.20 per million input tokens, from GPT-OSS and Gemma to Qwen, Llama, and GLM Flash. Full pricing table, one API key.",
		heading: "Cheapest Models",
		subheading:
			"Models at or under $0.20 per million input tokens ($1.50 output) — for classification, extraction, and high-volume workloads",
		intro: [
			"Every model here costs at most $0.20 per million input tokens and $1.50 per million output tokens — some, like Qwen3 4B and Llama 3.2 3B, as little as $0.03. At these prices a million-token workload costs a few cents, which changes what's economical: classify every support ticket, summarize every call, run an LLM check on every commit.",
			"Cheap doesn't mean toy: GPT-OSS 120B, GLM-4.7 Flash, Gemini 2.5 Flash-Lite, and Qwen3.5 9B punch far above their price on everyday tasks. Route high-volume work here and reserve frontier models for the requests that actually need them.",
		],
		faqs: [
			{
				question: "What is the cheapest LLM API?",
				answer:
					"In this catalog, Llama 3.2 3B and Qwen3 4B start around $0.03 per million input tokens, with GPT-OSS 20B at about $0.04 and GLM-4.7 Flash at $0.06. Prices differ per provider, so check the list — the same model is often cheaper through one provider than another.",
			},
			{
				question: "Are cheap models good enough for production?",
				answer:
					"For classification, extraction, routing, summarization, and simple chat — usually yes. Small models fail mostly on multi-step reasoning and niche knowledge. A common pattern is a cheap model as the default with automatic escalation to a frontier model when confidence is low.",
			},
			{
				question: "How else can I cut LLM costs?",
				answer:
					"Cache responses for repeated requests, use cached input pricing for long shared prefixes, batch offline work, and set per-project spending limits. Routing through a gateway also lets you switch to whichever provider currently offers the lowest price for the same model with zero code changes.",
			},
			{
				question: "Are there free models?",
				answer:
					"Yes — free mappings show up at $0.00 in this list. They're rate-limited and best for prototyping; for production traffic, the paid models on this page are the reliable low-cost option.",
			},
		],
	},
	"open-source": {
		metaTitle: "Best Open Source LLMs — Open-Weight Models via API",
		metaDescription:
			"Compare the best open-source and open-weight LLMs — Llama, DeepSeek, Qwen, GLM, Kimi K2, GPT-OSS, Gemma, and Mistral — served via API with per-token pricing.",
		heading: "Open Source Models",
		subheading:
			"Open-weight models — Llama, DeepSeek, Qwen, GLM, Kimi, GPT-OSS, Gemma, and more — served through one API",
		intro: [
			"Open-weight models have closed most of the gap with proprietary frontiers: DeepSeek V4, Qwen3.7, GLM-5, Kimi K2, and MiniMax M3 sit near the top of real-world leaderboards, joined by OpenAI's GPT-OSS and Google's Gemma releases. Their weights are public — but running a 200B+ parameter model yourself means serious GPU infrastructure.",
			"This page lists open-weight models served by hosted providers, so you get the openness — inspectable weights, no lock-in, the option to self-host later — with API convenience. LLM Gateway itself is open source (AGPLv3) and self-hostable, so the whole stack can run on your terms.",
		],
		faqs: [
			{
				question: "What is the best open source LLM?",
				answer:
					"DeepSeek V4, Qwen3.7, GLM-5.2, Kimi K2.6, and MiniMax M3 are the current leaders, each within striking distance of proprietary frontier models. For smaller, hardware-friendly options, GPT-OSS 20B, Gemma 4, and Qwen3.5 9B are the standouts.",
			},
			{
				question: "What does 'open source' mean for LLMs?",
				answer:
					"Usually 'open weight': the trained weights are downloadable, but licenses vary — some are Apache 2.0 or MIT, others (like the Llama license) carry usage restrictions, and training data is rarely published. Check the license of a specific model before building on it.",
			},
			{
				question: "Should I self-host or use an API?",
				answer:
					"Self-hosting pays off with steady high volume, strict data-residency needs, or fine-tuned weights. For everything else, per-token APIs are cheaper than idle GPUs. A middle path: develop against hosted open models and keep self-hosting as an exit option, since the weights are public.",
			},
			{
				question: "Are open models cheaper than proprietary ones?",
				answer:
					"Dramatically, per token. Competition among hosts drives prices down — DeepSeek V4 Flash and Qwen3 Coder 30B cost 10–50x less than frontier proprietary models. The list above shows every provider's price for each model.",
			},
		],
	},
} satisfies Record<string, ModelCategoryContent>;

export type ModelCategorySlug = keyof typeof modelCategoryContent;
