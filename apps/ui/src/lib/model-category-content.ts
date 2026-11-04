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
	"cyber-security": {
		metaTitle: "Best AI Models for Cyber Security — Compare Security LLMs",
		metaDescription:
			"Compare the best LLMs for cyber security work — code audits, log triage, malware analysis in a sandbox, CTFs, and pentest reports — including Chinese-lab models that do not stop mid-task. Prices, context windows, one API key.",
		heading: "Best Models for Cyber Security",
		subheading:
			"Models for code audits, log triage, threat modelling, CTFs, and sandboxed malware analysis — compared by price, context window, and whether they finish the task",
		intro: [
			"Security work puts two different demands on a language model. Defensive tasks — auditing a pull request for injection bugs, triaging a day of logs, writing a threat model or a pentest report — reward raw reasoning and a long context window, and every frontier model handles them. Offensive-adjacent tasks — explaining a malware sample in a sandbox, solving a CTF, triaging a crash into an exploitability verdict — also need a model that keeps going. Since September 2026, Anthropic's Claude Opus 5.5 ships with cyber safeguards that can stop a response mid-answer, and Anthropic's own launch benchmarks note that cyber tasks the safeguards interrupted were completed by Claude Opus 4.8 instead. OpenAI and Google apply similar classifiers to GPT-5.5 and Gemini.",
			"This page lists both kinds of model. Frontier options like Claude Opus 4.8, GPT-5.5, and Gemini 3.1 Pro for defensive review where quality matters most, and models from Chinese labs — DeepSeek, Moonshot (Kimi), Z.ai (GLM), Alibaba (Qwen), MiniMax, and Xiaomi — that are served with no cyber-specific refusal layer and cost a fraction of the price. Every one of them is reachable through the same OpenAI-compatible endpoint with one API key, so an agent can run the first pass on DeepSeek V4.1 Flash and escalate to a frontier model for the final report. For binary and firmware analysis specifically, see the reverse engineering models page.",
		],
		faqs: [
			{
				question: "What is the best AI model for cyber security?",
				answer:
					"For defensive work — code review, log analysis, threat modelling, report writing — Claude Opus 4.8, GPT-5.5, and Gemini 3.1 Pro produce the most thorough results. For hands-on analysis of malware samples, CTF challenges, or crash triage, Chinese-lab models such as DeepSeek V4 Pro, Kimi K3.1 Pro, GLM-5.2, and Qwen3.7 Max are the reliable choice because they are not wrapped in a cyber-specific refusal layer and will finish the task.",
			},
			{
				question: "Why do Claude and GPT models refuse security tasks?",
				answer:
					"Frontier labs run safety classifiers on cyber-adjacent prompts. Anthropic's Claude Opus 5.5 launch post states the model deploys with safeguards covering cybersecurity, and that when those safeguards intervened during benchmark testing the tasks were completed by Claude Opus 4.8. Since October 21, 2026, users on r/Claude have reported Opus 5.5 halting reverse-engineering requests mid-answer; Anthropic has not confirmed a change. Anthropic also runs a Cyber Verification Program that grants verified security practitioners wider access.",
			},
			{
				question: "Which models will not refuse malware analysis or CTF work?",
				answer:
					"Models from Chinese labs served through API providers — DeepSeek V4 Pro and V4.1 Flash, Kimi K3.1 Pro and K2.7 Code, GLM-5.2, Qwen3.7 Max and Qwen3.7 Plus, MiniMax M3, and MiMo V2.6 Pro — carry no cyber-specific classifier and complete sandboxed malware analysis, CTF challenges, and exploit triage. All of them support tool calling, so they work inside agents that drive Ghidra, Hopper, or a sandbox through MCP. Stay within the law: analyse systems you own or are authorised to test.",
			},
			{
				question: "How much does an AI security review cost?",
				answer:
					"A 2,000-line pull request is roughly 25,000 input tokens. Reviewing it on DeepSeek V4.1 Flash costs well under a cent; on Claude Opus 4.8 at $5 per million input tokens it is about 13 cents before output. For a daily log triage pipeline, route the bulk pass to a budget model and escalate only flagged findings to a frontier model — one API key covers both and every request is logged with its exact cost.",
			},
		],
	},
	"reverse-engineering": {
		metaTitle: "Best AI Models for Reverse Engineering — Compare RE LLMs",
		metaDescription:
			"Compare the best LLMs for reverse engineering — decompiling binaries, reading assembly, firmware and app analysis with REA, Ghidra, and Hopper. Chinese-lab models that finish the job, with prices and context windows.",
		heading: "Best Models for Reverse Engineering",
		subheading:
			"Models that read decompiler output, trace native code, and drive Ghidra, Hopper, and IDA through MCP — compared by price, context window, and tool support",
		intro: [
			"Reverse engineering with an AI agent is now a mainstream workflow: tools like REA (Reverse Engineer Anything, 380K+ GitHub stars) give Claude Code, Codex, Cursor, OpenCode, and Qwen Code an MCP server that inspects native binaries, Electron and JavaScript apps, .NET assemblies, firmware, and Unity IL2CPP metadata, with Ghidra, Hopper, or IDA doing the heavy lifting. The model's job is to read pseudocode and strings, name functions, follow cross-references, and turn evidence into an explanation or a working reimplementation. That takes strong code reasoning, a long context window for decompiler output, and reliable tool calling.",
			"It also takes a model that does not stop halfway. Since October 21, 2026, users have reported that Claude Opus 5.5 cuts off reverse-engineering requests mid-answer, and ChatGPT applies a similar refusal layer to decompilation and exploit questions. Models from DeepSeek, Moonshot (Kimi), Z.ai (GLM), Alibaba (Qwen), MiniMax, Xiaomi, and ByteDance have no such classifier, and several of them — DeepSeek V4 Pro, Kimi K3.1 Pro, GLM-5.2 — carry million-token windows that hold an entire Ghidra export. Every model on this page supports tool calling and is available through one OpenAI- and Anthropic-compatible endpoint, so you can point your existing agent at the gateway and keep the same REA setup.",
		],
		faqs: [
			{
				question: "What is the best AI model for reverse engineering?",
				answer:
					"DeepSeek V4 Pro and Kimi K3.1 Pro are the strongest Chinese-lab choices: both reason well over decompiler pseudocode, support tool calling for Ghidra and Hopper bridges, and hold a 1M-token context. GLM-5.2 and Qwen3.7 Max are close behind, and DeepSeek V4.1 Flash is the budget pick at $0.15 per million input tokens for bulk function naming and string analysis. Among Western models, Grok 4.3 and Gemini 3.1 Pro complete most RE tasks; Claude Opus 5.5 is currently reported to halt them.",
			},
			{
				question: "Does Claude refuse reverse engineering now?",
				answer:
					"Reports started on October 21, 2026 on r/Claude, covered by Kotaku and others: Claude Opus 5.5 begins analysing a target, then a safety guardrail stops the response mid-sentence and it will not reproduce the write-up even when reworded. Anthropic has not announced a change. Opus 5.5 launched on September 22, 2026 with safeguards that cover cybersecurity, and Anthropic's launch notes say interrupted cyber tasks in testing were completed by Claude Opus 4.8, which is why Opus 4.8 is on this list.",
			},
			{
				question: "Can I use REA with these models?",
				answer:
					"Yes. REA (npx rea-agents setup) registers an MCP server with Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Qwen Code, and other agents. Point that agent at LLM Gateway — https://api.llmgateway.io/v1 for OpenAI-compatible clients, or the Anthropic-compatible endpoint for Claude Code — with your gateway key and a model ID such as deepseek-v4-pro or kimi-k3.1-pro. REA's tools and skill stay the same; only the model behind the agent changes.",
			},
			{
				question: "Is AI-assisted reverse engineering legal?",
				answer:
					"Often, within limits. Analysing your own code, open-source software, malware in a sandbox, and CTF challenges is generally permitted; interoperability and security research have explicit exemptions in many jurisdictions. Copying closed-source code into a product, circumventing DRM, or probing systems you do not own is usually where it stops being legal. Check the licence and the law where you are before you publish results.",
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
	premium: {
		metaTitle: "Premium AI Models — High-Cost Frontier LLMs",
		metaDescription:
			"See exactly which AI models are classified as premium — priced at $5+ per million input tokens or $15+ per million output tokens — and which count against DevPass weekly fair-use allowances.",
		heading: "Premium Models",
		subheading:
			"Models priced at $5+ per million input tokens or $15+ per million output tokens — the exact list used for DevPass fair-use limits",
		intro: [
			"Premium is a pricing classification, not a curated list: a model lands on this page when any of its providers charges at least $5 per million input tokens or $15 per million output tokens. The classification is computed directly from catalogue prices after active public discounts, so this page always shows exactly which models are premium right now — every model not listed here is standard.",
			"The distinction matters for DevPass coding plans, where premium models are subject to a weekly fair-use allowance (a percentage of the plan's monthly credits) on top of the normal credit balance. When you call the LLM Gateway API directly with pay-as-you-go credits, premium models have no extra cap and no markup — you pay the same per-token provider prices shown here.",
		],
		faqs: [
			{
				question: "What makes a model premium?",
				answer:
					"Pricing alone. A model is premium when at least one of its providers charges $5 or more per million input tokens, or $15 or more per million output tokens. Prices are taken after any active public discount, so a promotion that brings a model below both thresholds makes it standard while it runs. There is no hand-picked list — the classification is recomputed from the live model catalogue, so it updates automatically when prices change.",
			},
			{
				question: "Do premium models cost extra on LLM Gateway?",
				answer:
					"No. LLM Gateway charges the same per-token provider prices for premium models as for any other model, with no markup. The premium classification only affects DevPass fair-use limits — it never changes what a request costs.",
			},
			{
				question: "How do premium models work on DevPass plans?",
				answer:
					"DevPass plans include a weekly fair-use allowance for premium models: 10% of monthly credits on Lite, 12% on Pro, and 15% on Max. The allowance works on a rolling 7-day window that opens with your first premium request and fully resets when it ends; a monthly renewal starts a new window, and redeeming a Reset Pass clears the current one so your next premium request starts fresh. Standard models are never affected by it — they draw only on the plan's monthly allowance and its daily pacing, like every other model.",
			},
			{
				question: "How do I check whether a specific model is premium?",
				answer:
					"If it appears on this page, it's premium; otherwise it's standard. In the full models directory, premium models are marked with a gem icon, and the DevPass models directory offers a pricing-tier filter, since the distinction only affects DevPass fair-use limits. The classification is also documented in the model categories guide in our docs.",
			},
		],
	},
} satisfies Record<string, ModelCategoryContent>;

export type ModelCategorySlug = keyof typeof modelCategoryContent;
