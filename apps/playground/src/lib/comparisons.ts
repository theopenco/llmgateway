/**
 * Single source of truth for every comparison page under /compare.
 *
 * One entry per competitor. The dynamic route, the index hub, the metadata,
 * the comparison table, and the FAQ schema all read from this file — update a
 * price or a fact once here and it propagates everywhere.
 *
 * Tone rule: be honest. Every entry names what the competitor is genuinely
 * better at. Readers are mid-evaluation and will verify claims, so accuracy is
 * the conversion strategy.
 */

import {
	CHAT_PLAN_CREDITS_MULTIPLIERS,
	CHAT_PLAN_PRICES,
	type ChatPlanTier,
} from "@llmgateway/shared";

export type CompetitorCategory =
	| "single-vendor"
	| "aggregator"
	| "answer-engine"
	| "developer";

export interface ComparisonRow {
	/** Dimension being compared, e.g. "Model access". */
	label: string;
	/** LLM Gateway Chat's answer. */
	us: string;
	/** Competitor's answer. */
	them: string;
	/** When true, render this row as a clear win for us (subtle highlight). */
	usWins?: boolean;
}

export interface ComparisonSection {
	heading: string;
	us: string;
	them: string;
	/** A one-line "choose X if…" verdict that keeps the section fair. */
	bottomLine: string;
}

export interface FaqItem {
	q: string;
	a: string;
}

export interface Comparison {
	slug: string;
	/** Short brand name, e.g. "ChatGPT". */
	competitor: string;
	/** Brand + vendor, e.g. "ChatGPT (OpenAI)". */
	competitorFull: string;
	competitorTagline: string;
	category: CompetitorCategory;

	/** SEO. */
	metaTitle: string;
	metaDescription: string;

	/** Hero. */
	eyebrow: string;
	/** TL;DR shown at the top and used as the index card blurb. */
	verdict: string;

	/** Price strip. */
	usPrice: string;
	themPrice: string;

	/** At-a-glance table. */
	table: ComparisonRow[];

	/** Deeper, paragraph-style category comparisons. */
	sections: ComparisonSection[];

	/** Honest "who should pick the competitor". */
	chooseThem: string[];
	/** "Who should pick us". */
	chooseUs: string[];

	/** "[Competitor] alternative" intent block. */
	switchHeading: string;
	whySwitch: string[];
	migration: string;

	faq: FaqItem[];
}

/**
 * LLM Gateway Chat — our own profile. Kept here so the same facts feed every
 * page and the index. These mirror packages/shared/src/chat-plans.ts.
 */
/**
 * Plan facts derived from the shared chat-plan source of truth so a pricing
 * change in packages/shared/src/chat-plans.ts propagates here automatically.
 * `value` is the credit allowance at provider rates (price × tapered multiplier).
 */
function planFacts(tier: ChatPlanTier) {
	const price = CHAT_PLAN_PRICES[tier];
	const multiplier = CHAT_PLAN_CREDITS_MULTIPLIERS[tier];
	return { price, multiplier, value: price * multiplier };
}

export const US = {
	name: "LLM Gateway Chat",
	url: "https://chat.llmgateway.io",
	modelCount: "200+",
	plans: {
		starter: planFacts("starter"),
		plus: planFacts("plus"),
		pro: planFacts("pro"),
	},
} as const;

export const comparisons: Comparison[] = [
	{
		slug: "chatgpt",
		competitor: "ChatGPT",
		competitorFull: "ChatGPT (OpenAI)",
		competitorTagline: "The mainstream default — OpenAI models only",
		category: "single-vendor",
		metaTitle: "LLM Gateway Chat vs ChatGPT — every model, one subscription",
		metaDescription:
			"ChatGPT only runs OpenAI models. LLM Gateway Chat gives you GPT, Claude, Gemini and Grok on one $19/mo subscription — switch models mid-chat.",
		eyebrow: "Single vendor vs every frontier model",
		verdict:
			"ChatGPT is the most polished single-vendor assistant, and at $20/mo Plus you get GPT plus native image and voice. But you only ever get OpenAI models. LLM Gateway Chat runs GPT, Claude, Gemini, and Grok side by side for $19/mo — so you stop paying separate subscriptions to reach the model that's actually best for the task.",
		usPrice: "$19/mo",
		themPrice: "$20/mo",
		table: [
			{
				label: "Models",
				us: "200+ across OpenAI, Anthropic, Google, xAI, DeepSeek, Meta, Mistral and more",
				them: "OpenAI only (GPT-5.x family)",
				usWins: true,
			},
			{
				label: "Switch models mid-chat",
				us: "Yes — change model on any message, keep the thread",
				them: "Only between OpenAI models",
				usWins: true,
			},
			{
				label: "Entry paid plan",
				us: "$9 Starter, $19 Plus (all frontier models)",
				them: "$8 Go (with ads), $20 Plus",
			},
			{
				label: "How you pay",
				us: "Subscription credits at provider rates — 2.5× value on Plus",
				them: "Flat subscription, usage capped by tier",
			},
			{
				label: "Image generation",
				us: "Yes — multiple image models",
				them: "Yes — native, strong",
			},
			{
				label: "Video generation",
				us: "Yes — Veo, Wan and others",
				them: "Sora, on higher tiers",
			},
			{
				label: "Compare models side by side",
				us: "Yes — group chat, one prompt to many models",
				them: "No",
				usWins: true,
			},
			{
				label: "Pay-as-you-go fallback",
				us: "Top-ups never expire, used after monthly credits",
				them: "No — hard tier limits",
				usWins: true,
			},
		],
		sections: [
			{
				heading: "Model access",
				us: "Every message can run on a different model. Draft with GPT, pressure-test the logic with Claude, fact-check with Gemini, all in one thread on one balance.",
				them: "ChatGPT is OpenAI's storefront for OpenAI's models. When a competing model is better for a task — Claude for code, Gemini for long context — you can't reach it without a second subscription.",
				bottomLine:
					"Choose ChatGPT if you only ever want GPT. Choose LLM Gateway Chat if you want the best model per task.",
			},
			{
				heading: "Pricing and value",
				us: "Plus is $19/mo and your credits are worth $47.50 at provider rates — 2.5× what you pay. Spend it across any model. When credits run out, pay-as-you-go top-ups keep you going instead of hitting a wall.",
				them: "Plus is $20/mo for one model family. The next step up is a $200/mo Pro tier, and the cheaper $8 Go tier shows ads in the US.",
				bottomLine:
					"Comparable entry price, but LLM Gateway Chat spreads it across every provider.",
			},
			{
				heading: "Features beyond chat",
				us: "Image, video, and audio generation plus side-by-side group chat all sit in the same subscription and the same credit balance.",
				them: "ChatGPT has excellent native image generation, Advanced Voice, and Sora video on higher tiers — a genuinely strong, well-integrated suite.",
				bottomLine:
					"ChatGPT's native media is more polished; LLM Gateway Chat covers more providers under one balance.",
			},
		],
		chooseThem: [
			"You're happy living inside OpenAI's ecosystem and Custom GPTs",
			"You want the most polished native image and voice experience",
			"You rely on Sora video or Agent Mode specifically",
		],
		chooseUs: [
			"You want GPT, Claude, Gemini, and Grok without three subscriptions",
			"You switch models depending on the task",
			"You'd rather pay provider rates with credits that go further",
			"You want image, video, audio, and multi-model comparison in one place",
		],
		switchHeading: "Looking for a ChatGPT alternative?",
		whySwitch: [
			"You keep wishing you could use Claude or Gemini without leaving ChatGPT",
			"You're paying for ChatGPT Plus and a second AI subscription on top",
			"Ads showing up on lower tiers and the $200 jump to Pro feel off",
			"You want to compare answers across models before you trust one",
		],
		migration:
			"There's nothing to migrate — start a chat at chat.llmgateway.io, pick GPT-5 if that's your habit, and add Claude or Gemini to the same thread when you need them. Keep ChatGPT too; many people drop the second subscription once one balance reaches every model.",
		faq: [
			{
				q: "Is LLM Gateway Chat a ChatGPT alternative?",
				a: "Yes. It's a multi-model chat app that includes OpenAI's GPT models alongside Claude, Gemini, Grok, and 200+ others, so a single $19/mo subscription replaces ChatGPT Plus plus the other AI subscriptions you'd otherwise stack on top.",
			},
			{
				q: "Can I still use GPT-5 on LLM Gateway Chat?",
				a: "Yes. GPT-5 and the rest of the OpenAI lineup are available on the Plus and Pro plans. Starter covers most models but excludes frontier tiers like GPT-5.",
			},
			{
				q: "How is the pricing different from ChatGPT Plus?",
				a: "Both are about $20/mo, but ChatGPT Plus only buys OpenAI models. On LLM Gateway Chat your $19 becomes $47.50 of credits at provider rates that you can spend across every model, with pay-as-you-go top-ups as a fallback.",
			},
			{
				q: "Does it have image generation like ChatGPT?",
				a: "Yes — image, video, and audio generation are built in. ChatGPT's native image generation is more tightly integrated, but LLM Gateway Chat gives you multiple image, video, and audio models on the same balance.",
			},
		],
	},
	{
		slug: "claude",
		competitor: "Claude",
		competitorFull: "Claude (Anthropic)",
		competitorTagline: "Best-in-class writing and code — Anthropic models only",
		category: "single-vendor",
		metaTitle:
			"LLM Gateway Chat vs Claude — keep Claude, add every other model",
		metaDescription:
			"Claude Pro is $20/mo for Anthropic models only. LLM Gateway Chat keeps Claude and adds GPT, Gemini and Grok on one $19/mo balance — no opaque limits.",
		eyebrow: "One great model vs all of them",
		verdict:
			"Claude is many people's favorite model for writing and code, and Claude Pro at $20/mo is a clean, ad-free experience. The catch is it only runs Anthropic models, it has no native image generation, and its usage limits are famously opaque. LLM Gateway Chat keeps Claude Opus and Sonnet and adds GPT, Gemini, and Grok on one $19/mo balance.",
		usPrice: "$19/mo",
		themPrice: "$20/mo",
		table: [
			{
				label: "Models",
				us: "Claude Opus, Sonnet, Haiku + GPT, Gemini, Grok and 200+ more",
				them: "Anthropic only (Opus, Sonnet, Haiku)",
				usWins: true,
			},
			{
				label: "Switch models mid-chat",
				us: "Yes — fall back to GPT or Gemini without losing the thread",
				them: "Only between Claude models",
				usWins: true,
			},
			{
				label: "Usage limits",
				us: "Transparent credits — you see cost per message and what's left",
				them: "Opaque conversation budget; weekly caps on Pro/Max",
				usWins: true,
			},
			{
				label: "Image generation",
				us: "Yes — multiple image models",
				them: "No — reads images, can't generate them",
				usWins: true,
			},
			{
				label: "Entry paid plan",
				us: "$19 Plus (all frontier models)",
				them: "$20 Pro, then $100 / $200 Max",
			},
			{
				label: "Coding",
				us: "Claude plus other strong coding models, side by side",
				them: "Claude Code is excellent and deeply integrated",
			},
			{
				label: "Compare models side by side",
				us: "Yes — group chat across providers",
				them: "No",
				usWins: true,
			},
			{
				label: "Ads",
				us: "None",
				them: "None",
			},
		],
		sections: [
			{
				heading: "Model access",
				us: "Claude Opus and Sonnet are first-class here. The difference is you can switch to GPT or Gemini for a tricky step and switch back, all in the same conversation and the same balance.",
				them: "Claude only runs Anthropic models. When you want a second opinion or a model that's stronger on a specific task, you leave the app.",
				bottomLine:
					"Choose Claude if you only ever want Claude. Choose LLM Gateway Chat if you want Claude and everything else.",
			},
			{
				heading: "Usage limits and transparency",
				us: "You see the cost of each message and how much of your monthly credit is left. Run out and pay-as-you-go top-ups take over instead of cutting you off.",
				them: "Claude's biggest, most repeated complaint is opaque usage limits — a 'conversation budget' with weekly caps on Pro and Max that even paying users hit without warning.",
				bottomLine:
					"If predictable, visible usage matters to you, transparent credits beat an unpublished cap.",
			},
			{
				heading: "Image generation",
				us: "Image, video, and audio generation are built in, alongside chat, on the same subscription.",
				them: "Claude can read and analyze images and produce diagrams or SVG, but it cannot generate photos or illustrations.",
				bottomLine:
					"Need to create images, not just read them? That's a clear gap LLM Gateway Chat fills.",
			},
		],
		chooseThem: [
			"Claude is your daily driver and you rarely reach for another model",
			"You live in Claude Code or Claude's Projects and Artifacts",
			"You want Anthropic's specific safety and privacy posture",
		],
		chooseUs: [
			"You love Claude but keep wanting GPT or Gemini for some tasks",
			"You're tired of hitting Claude's invisible usage walls",
			"You need to generate images, video, or audio too",
			"You want one balance instead of Claude Pro plus another subscription",
		],
		switchHeading: "Looking for a Claude alternative?",
		whySwitch: [
			"You keep hitting Claude's weekly limits mid-task",
			"You want a second model's take without opening another app",
			"You need image generation Claude doesn't offer",
			"You'd rather see exactly what each message costs",
		],
		migration:
			"Keep using Claude exactly as you do — Opus and Sonnet are right here. Start a thread at chat.llmgateway.io, pick Claude, and when you hit a wall or want a comparison, switch to GPT or Gemini in the same conversation. Most people keep Claude as their default model and drop the standalone subscription.",
		faq: [
			{
				q: "Does LLM Gateway Chat include Claude?",
				a: "Yes. Claude Opus, Sonnet, and Haiku are available on the Plus and Pro plans, alongside GPT, Gemini, Grok, and 200+ other models on one credit balance.",
			},
			{
				q: "Why use LLM Gateway Chat instead of Claude Pro?",
				a: "Same roughly $20/mo price, but you get Claude plus every other frontier model, transparent per-message credits instead of opaque caps, and built-in image, video, and audio generation that Claude doesn't offer.",
			},
			{
				q: "Does Claude have usage limits I avoid here?",
				a: "Claude Pro and Max enforce an unpublished 'conversation budget' with weekly caps. LLM Gateway Chat uses visible credits — you see each message's cost and your remaining balance, with pay-as-you-go top-ups as a fallback.",
			},
			{
				q: "Can I generate images like I can't on Claude?",
				a: "Yes. Claude can read images but not create them. LLM Gateway Chat includes multiple image, video, and audio generation models in the same subscription.",
			},
		],
	},
	{
		slug: "gemini",
		competitor: "Gemini",
		competitorFull: "Google Gemini",
		competitorTagline:
			"Huge context and Google integration — Google models only",
		category: "single-vendor",
		metaTitle: "LLM Gateway Chat vs Google Gemini — beyond one model family",
		metaDescription:
			"Google AI Pro is $19.99/mo for Gemini only. LLM Gateway Chat puts Gemini next to GPT, Claude and Grok on one $19/mo subscription with clear credits.",
		eyebrow: "Google's models vs all of them",
		verdict:
			"Gemini is a strong, deeply Google-integrated assistant with a massive context window and native video generation, and Google AI Pro is $19.99/mo. But it only runs Google's models and leans on your Google account to feel valuable. LLM Gateway Chat puts Gemini next to GPT, Claude, and Grok for $19/mo on one balance.",
		usPrice: "$19/mo",
		themPrice: "$19.99/mo",
		table: [
			{
				label: "Models",
				us: "Gemini + GPT, Claude, Grok and 200+ more",
				them: "Google only (Gemini family)",
				usWins: true,
			},
			{
				label: "Switch models mid-chat",
				us: "Yes — across every provider",
				them: "Only between Gemini models",
				usWins: true,
			},
			{
				label: "Ecosystem lock-in",
				us: "None — works on its own at chat.llmgateway.io",
				them: "Most value comes through your Google account and Workspace",
				usWins: true,
			},
			{
				label: "Long context",
				us: "Long-context models including Gemini's 1M window",
				them: "Excellent — 1M-token context",
			},
			{
				label: "Video generation",
				us: "Yes — Veo, Wan and others",
				them: "Yes — Veo, strong native video",
			},
			{
				label: "Entry paid plan",
				us: "$9 Starter, $19 Plus",
				them: "$4.99 AI Plus, $19.99 AI Pro, $100 / $200 Ultra",
			},
			{
				label: "Compare models side by side",
				us: "Yes — group chat across providers",
				them: "No",
				usWins: true,
			},
			{
				label: "Usage transparency",
				us: "Per-message credit cost, visible balance",
				them: "Compute-based limits; media credits were removed",
			},
		],
		sections: [
			{
				heading: "Model access",
				us: "Gemini Pro is available here with its long context intact, but it sits next to GPT, Claude, and Grok so you can switch when another model wins a task.",
				them: "Gemini runs only Google's models. It's powerful, but it's a single family, and you can't bring a competing model into the conversation.",
				bottomLine:
					"Choose Gemini if you're all-in on Google. Choose LLM Gateway Chat if you want Gemini plus everyone else.",
			},
			{
				heading: "Ecosystem and lock-in",
				us: "LLM Gateway Chat is standalone. It doesn't need your email or documents to be useful — you sign in and chat across providers.",
				them: "Gemini's strongest features lean on Gmail, Drive, and Workspace. If you don't live in Google's ecosystem, a lot of the value drops away, and the plan names (two different 'Ultra' tiers) are confusing.",
				bottomLine:
					"Deep in Google Workspace? Gemini integrates beautifully. Otherwise that lock-in is a cost.",
			},
			{
				heading: "Value and transparency",
				us: "Your $19 becomes $47.50 of credits at provider rates, visible per message, spendable on any model.",
				them: "Google AI Pro is $19.99/mo and bundles storage and YouTube perks, but it moved to opaque compute-based usage and removed the monthly media-generation credits users relied on.",
				bottomLine:
					"Gemini bundles more Google perks; LLM Gateway Chat gives clearer, model-agnostic value.",
			},
		],
		chooseThem: [
			"You live in Gmail, Docs, and Google Drive all day",
			"You want the deepest Deep Research and native video",
			"The bundled storage and YouTube perks matter to you",
		],
		chooseUs: [
			"You want Gemini's long context but also GPT and Claude",
			"You don't want your AI tied to your Google account",
			"You want transparent per-message usage instead of compute limits",
			"You want to compare Gemini against other models on the same prompt",
		],
		switchHeading: "Looking for a Gemini alternative?",
		whySwitch: [
			"You want Gemini's context window without being locked to Google",
			"You miss the media credits Google removed from AI Pro",
			"You want GPT or Claude in the same conversation",
			"The overlapping Ultra plan tiers are hard to reason about",
		],
		migration:
			"Sign in at chat.llmgateway.io and pick Gemini — the long-context model you already use is there. Add GPT or Claude to the same thread whenever you want a second take. Nothing is tied to your Google account, so you keep full control of your data.",
		faq: [
			{
				q: "Is LLM Gateway Chat a Google Gemini alternative?",
				a: "Yes. It includes Gemini's models alongside GPT, Claude, Grok, and 200+ others on one $19/mo balance, without tying your chats to a Google account.",
			},
			{
				q: "Do I still get Gemini's long context window?",
				a: "Yes. Long-context Gemini models, including the 1M-token window, are available on Plus and Pro.",
			},
			{
				q: "How is this different from Google AI Pro?",
				a: "Google AI Pro is $19.99/mo for Google's models plus storage and YouTube perks, with value tied to your Google account. LLM Gateway Chat is $19/mo for every frontier model on a standalone, transparent credit balance.",
			},
			{
				q: "Does it generate video like Gemini?",
				a: "Yes. Video generation is built in via Veo, Wan, and other models, alongside image and audio generation.",
			},
		],
	},
	{
		slug: "poe",
		competitor: "Poe",
		competitorFull: "Poe (by Quora)",
		competitorTagline: "Multi-model aggregator with a confusing points system",
		category: "aggregator",
		metaTitle: "LLM Gateway Chat vs Poe — multi-model chat without points math",
		metaDescription:
			"Poe meters every model with confusing compute points. LLM Gateway Chat gives you 200+ models on transparent provider-rate credits for $19/mo.",
		eyebrow: "Compute points vs transparent credits",
		verdict:
			"Poe pioneered multi-model chat and has huge breadth, including user-built bots and group chats. Its weak point, by far the most common complaint, is the compute-points system: every model costs a different, hard-to-predict number of points, nothing rolls over, and frontier models drain your balance fast. LLM Gateway Chat is also one balance across every model, but priced as transparent credits at provider rates.",
		usPrice: "$19/mo",
		themPrice: "$19.99/mo",
		table: [
			{
				label: "Models",
				us: "200+ across every major provider",
				them: "100+ models plus user-built bots",
			},
			{
				label: "How usage is metered",
				us: "Credits at provider rates — you see the real cost per message",
				them: "Compute points that vary per model and are hard to budget",
				usWins: true,
			},
			{
				label: "Credit value",
				us: "2.5× value on Plus — $19 becomes $47.50",
				them: "Points priced opaquely; frontier models burn thousands each",
				usWins: true,
			},
			{
				label: "When you run out",
				us: "Pay-as-you-go top-ups take over — never expire",
				them: "Wait for reset or buy add-on points (about $30 per million)",
				usWins: true,
			},
			{
				label: "Rollover",
				us: "Monthly credits reset; top-ups never expire",
				them: "No rollover on any tier",
			},
			{
				label: "Media generation",
				us: "Image, video, and audio models built in",
				them: "Image, video, and voice models (also priced in points)",
			},
			{
				label: "Group chat / comparison",
				us: "Yes — one prompt to many models",
				them: "Yes — group chats across models and bots",
			},
			{
				label: "Custom bots",
				us: "Not the focus — straight model access",
				them: "Yes — large creator ecosystem",
			},
		],
		sections: [
			{
				heading: "How you pay",
				us: "Credits are denominated in real money at provider rates. You see what each message costs and what's left. The mental model is simple: a dollar of credit buys a dollar of inference, and Plus gives you 2.5× the dollars you pay.",
				them: "Poe charges in compute points. A budget model might cost a few points; a frontier model can cost thousands per message; a large file analysis tens of thousands. Predicting how long a month's allotment lasts is genuinely hard, which is the single most common Poe complaint.",
				bottomLine:
					"If you've ever been surprised by how fast Poe points vanish, transparent credits fix exactly that.",
			},
			{
				heading: "Running out",
				us: "When monthly credits are spent, pay-as-you-go top-ups kick in automatically and never expire. You're never forced to stop mid-task.",
				them: "When points run out you wait for the reset, upgrade a tier, or buy add-on points at roughly $30 per million. Nothing rolls over.",
				bottomLine:
					"Both are one balance for many models; LLM Gateway Chat's balance is predictable and has a fallback.",
			},
			{
				heading: "Breadth and bots",
				us: "The focus is direct, fast access to 200+ first-party models with image, video, and audio generation and side-by-side comparison.",
				them: "Poe's real edge is its ecosystem: millions of user-created bots, creator monetization, and large group chats. If that ecosystem is why you're there, it's a genuine strength.",
				bottomLine:
					"Want a bot marketplace? Poe wins. Want clean, predictable access to the models themselves? That's us.",
			},
		],
		chooseThem: [
			"You love Poe's custom bots and creator ecosystem",
			"You run big multi-bot group chats",
			"You're comfortable managing the points system",
		],
		chooseUs: [
			"You're tired of guessing how many messages your points buy",
			"You want credits priced in real money at provider rates",
			"You want a top-up fallback so you never hit a hard stop",
			"You want 2.5× credit value rather than opaque per-model pricing",
		],
		switchHeading: "Looking for a Poe alternative?",
		whySwitch: [
			"The compute-points system is impossible to budget",
			"Frontier models drain your monthly points in a few dozen messages",
			"Nothing rolls over and add-on points are expensive",
			"You want to know what each message actually costs",
		],
		migration:
			"Bring the same habit — one balance, every model — minus the points math. Sign in at chat.llmgateway.io, and instead of translating messages into points, you spend credits priced at provider rates with each message's cost shown plainly.",
		faq: [
			{
				q: "How is LLM Gateway Chat different from Poe?",
				a: "Both give you many models on one balance. The difference is the meter: Poe uses compute points that vary per model and don't roll over, while LLM Gateway Chat uses credits priced at real provider rates, shown per message, with pay-as-you-go top-ups as a fallback.",
			},
			{
				q: "Does it have as many models as Poe?",
				a: "It includes 200+ first-party models across every major provider. Poe adds a large catalog of user-built bots on top; if a creator bot ecosystem is what you want, Poe is stronger there.",
			},
			{
				q: "Will I run out as fast as I do on Poe?",
				a: "Plus gives you 2.5× your spend in credits at provider rates, and when monthly credits are gone, top-ups that never expire keep you going — so there's no hard stop the way there is when Poe points run out.",
			},
			{
				q: "Can I do group chats like Poe?",
				a: "Yes. Group chat sends one prompt to multiple models at once so you can compare answers side by side.",
			},
		],
	},
	{
		slug: "t3-chat",
		competitor: "T3 Chat",
		competitorFull: "T3 Chat (t3.gg)",
		competitorTagline: "Fast, cheap multi-model chat — light on extras",
		category: "aggregator",
		metaTitle:
			"LLM Gateway Chat vs T3 Chat — multi-model chat with a media studio",
		metaDescription:
			"T3 Chat is fast $8/mo multi-model chat with no media generation. LLM Gateway Chat adds image, video, audio and group chat across 200+ models.",
		eyebrow: "Fast and minimal vs full studio",
		verdict:
			"T3 Chat is genuinely excellent at one thing: fast, clean multi-model chat for $8/mo, with bring-your-own-key support. It's also deliberately minimal — no native mobile app, no voice, no persistent memory, and no real media generation. LLM Gateway Chat costs more but adds image, video, and audio generation, group chat, and a transparent credit balance.",
		usPrice: "$19/mo",
		themPrice: "$8/mo",
		table: [
			{
				label: "Price",
				us: "$9 Starter, $19 Plus",
				them: "$8/mo Pro — cheaper",
			},
			{
				label: "Models",
				us: "200+ across every major provider",
				them: "Dozens across major providers",
			},
			{
				label: "Speed",
				us: "Streaming, fast",
				them: "Exceptionally fast UI — its signature strength",
			},
			{
				label: "Image / video / audio generation",
				us: "Yes — built in",
				them: "Limited image generation; no real video/audio studio",
				usWins: true,
			},
			{
				label: "Compare models side by side",
				us: "Yes — group chat",
				them: "No",
				usWins: true,
			},
			{
				label: "Persistent memory",
				us: "Conversations persist; fork and revisit",
				them: "No cross-conversation memory",
				usWins: true,
			},
			{
				label: "Usage model",
				us: "Provider-rate credits, 2.5× value, top-up fallback",
				them: "Flat fee with a refilling usage bar; BYOK supported",
			},
			{
				label: "Share read-only chats",
				us: "Yes — public snapshot links",
				them: "Limited",
			},
		],
		sections: [
			{
				heading: "Speed and simplicity",
				us: "Responses stream quickly and you can switch models on any message. It's fast, but speed isn't the entire pitch — the studio features around chat are.",
				them: "T3 Chat's whole identity is speed. The UI renders tokens as fast as anything out there, and for pure text chat that feels great. If raw responsiveness is all you want, T3 is hard to beat.",
				bottomLine:
					"Want the fastest bare-bones text chat for $8? T3 wins on price and feel.",
			},
			{
				heading: "Features beyond chat",
				us: "Image, video, and audio generation and side-by-side group chat are built into the same subscription and balance.",
				them: "T3 is deliberately lean: no native mobile app, no voice mode, no persistent memory across chats, and image generation is limited. Those are conscious omissions, not bugs.",
				bottomLine:
					"If you want a media studio and model comparison, not just chat, that's the gap LLM Gateway Chat fills.",
			},
			{
				heading: "How you pay",
				us: "Credits priced at provider rates with 2.5× value on Plus and top-ups that never expire. You see the cost of each message.",
				them: "A flat $8/mo with a usage bar that refills on a timer, plus bring-your-own-key for unmetered use if you have your own provider keys.",
				bottomLine:
					"T3 is cheaper and BYOK-friendly; LLM Gateway Chat trades a higher price for more capability and clearer value.",
			},
		],
		chooseThem: [
			"You want the cheapest fast multi-model chat",
			"You have your own API keys and want BYOK",
			"You only need text chat and value speed above all",
		],
		chooseUs: [
			"You want image, video, and audio generation in the same app",
			"You want to compare models side by side on one prompt",
			"You want conversations that persist and can be shared",
			"You want transparent credits with a no-hard-stop fallback",
		],
		switchHeading: "Looking for a T3 Chat alternative?",
		whySwitch: [
			"You've outgrown text-only chat and want a media studio",
			"You miss persistent memory across conversations",
			"You want a mobile-friendly web app and voice options",
			"You want to compare model answers side by side",
		],
		migration:
			"If you like fast multi-model chat, you'll feel at home — pick a model, start typing at chat.llmgateway.io. The difference is what surrounds the chat: image, video, and audio generation, group chat, persistent and shareable conversations, all on one credit balance.",
		faq: [
			{
				q: "Is LLM Gateway Chat worth more than T3 Chat's $8?",
				a: "It depends on what you need. T3 is cheaper and faster for pure text chat. LLM Gateway Chat costs $19 on Plus but adds image, video, and audio generation, side-by-side group chat, persistent shareable conversations, and 200+ models with transparent credits.",
			},
			{
				q: "Does it support bring-your-own-key like T3?",
				a: "LLM Gateway Chat is built around a managed credit balance rather than BYOK. The whole platform, LLM Gateway, does support your own provider keys if you need that route.",
			},
			{
				q: "Is it as fast as T3 Chat?",
				a: "Responses stream in real time and model switching is instant. T3's UI is purpose-built for raw rendering speed, so it still feels fastest for plain text — LLM Gateway Chat trades a little of that for a full media studio.",
			},
			{
				q: "Does it remember past conversations?",
				a: "Yes. Conversations persist, can be forked, and can be shared as read-only links — T3 Chat has no cross-conversation memory.",
			},
		],
	},
	{
		slug: "perplexity",
		competitor: "Perplexity",
		competitorFull: "Perplexity",
		competitorTagline: "Best-in-class answer engine — not a general chat app",
		category: "answer-engine",
		metaTitle: "LLM Gateway Chat vs Perplexity — a chat app, not a search box",
		metaDescription:
			"Perplexity is the best answer engine but weak at open-ended chat and coding. LLM Gateway Chat is a full multi-model chat and media studio for $19/mo.",
		eyebrow: "Cited search vs full multi-model chat",
		verdict:
			"Perplexity is the best tool for cited web research — fast, sourced answers to factual questions. But by design it's an answer engine, not a chat partner: it's weaker at open-ended conversation, creative writing, and sustained coding, and it loses the thread in long sessions. LLM Gateway Chat is a general multi-model chat and media studio. They solve different problems.",
		usPrice: "$19/mo",
		themPrice: "$20/mo",
		table: [
			{
				label: "Primary job",
				us: "General chat, creative work, coding, media generation",
				them: "Cited web search and research",
			},
			{
				label: "Models",
				us: "200+ — pick or switch any model per message",
				them: "Frontier models per query, plus its own Sonar",
			},
			{
				label: "Cited web search",
				us: "Web search available across models",
				them: "Best-in-class — sourced, real-time answers",
			},
			{
				label: "Long conversations",
				us: "Holds context; fork and continue threads",
				them: "Tends to lose context in long chats",
				usWins: true,
			},
			{
				label: "Creative & coding work",
				us: "Strong — full frontier models for writing and code",
				them: "Weaker — optimized for answers, not building",
				usWins: true,
			},
			{
				label: "Media generation",
				us: "Image, video, and audio built in",
				them: "Some image/video on higher tiers",
			},
			{
				label: "Price",
				us: "$9 Starter, $19 Plus",
				them: "$20 Pro, $200 Max",
			},
			{
				label: "Compare models side by side",
				us: "Yes — group chat",
				them: "Model Council on Max synthesizes several",
			},
		],
		sections: [
			{
				heading: "What each is built for",
				us: "LLM Gateway Chat is a conversation and creation tool: long threads, drafting, coding, brainstorming, and generating images, video, and audio — with full frontier models you switch between.",
				them: "Perplexity is an answer engine. Ask a factual question and it returns a fast, cited, well-sourced answer. That's a genuinely different and excellent job.",
				bottomLine:
					"For 'find and cite an answer,' use Perplexity. For 'think, write, build, create,' use LLM Gateway Chat.",
			},
			{
				heading: "Conversation and creative depth",
				us: "Full models like GPT, Claude, and Gemini run as themselves, so writing, reasoning, and coding hold up over long, evolving conversations.",
				them: "Reviewers and Perplexity's own positioning agree it's weaker at open-ended chat, creative writing, brand voice, and sustained coding, and it can drop context in long threads.",
				bottomLine:
					"If your work is creative or code-heavy, a real chat app serves you better than an answer engine.",
			},
			{
				heading: "Web research",
				us: "Web search is available across models when you need current information, though research citations aren't the core product.",
				them: "This is Perplexity's home turf — cited sources, Deep Research reports, and real-time accuracy are best-in-class.",
				bottomLine:
					"Be honest: for live cited research, Perplexity leads. Many people use both.",
			},
		],
		chooseThem: [
			"Your main need is fast, cited answers to factual questions",
			"You want Deep Research reports with sources",
			"You're researching, not drafting or building",
		],
		chooseUs: [
			"You want a general chat partner for writing and coding",
			"You need long conversations that hold context",
			"You want image, video, and audio generation too",
			"You want to switch between full frontier models per task",
		],
		switchHeading: "Looking for a Perplexity alternative?",
		whySwitch: [
			"You need a chat partner, not just a search box",
			"Perplexity loses the thread in long conversations",
			"You want stronger creative writing and coding",
			"You want to generate images, video, and audio too",
		],
		migration:
			"Many people keep Perplexity for cited research and use LLM Gateway Chat for everything else — writing, coding, brainstorming, and media. Sign in at chat.llmgateway.io, pick any frontier model, and you've got a conversation tool Perplexity was never built to be.",
		faq: [
			{
				q: "Is LLM Gateway Chat a Perplexity alternative?",
				a: "For general chat, creative work, and coding, yes. Perplexity is purpose-built for cited web search; LLM Gateway Chat is a general multi-model chat and media studio. They're often used together.",
			},
			{
				q: "Does it do cited web research like Perplexity?",
				a: "Web search is available across models for current information, but Perplexity's cited Deep Research is best-in-class. If sourced research is your main job, Perplexity still leads there.",
			},
			{
				q: "Which is better for coding and writing?",
				a: "LLM Gateway Chat. It runs full frontier models like GPT, Claude, and Gemini that hold context across long threads, where Perplexity is tuned for short, sourced answers.",
			},
			{
				q: "Is it cheaper than Perplexity Pro?",
				a: "Plus is $19/mo versus Perplexity Pro at $20/mo, and it covers chat, coding, and media generation across 200+ models rather than search alone.",
			},
		],
	},
	{
		slug: "openrouter",
		competitor: "OpenRouter",
		competitorFull: "OpenRouter",
		competitorTagline: "Developer API marketplace with a bare chatroom",
		category: "developer",
		metaTitle:
			"LLM Gateway Chat vs OpenRouter — a real chat app, not a dev tool",
		metaDescription:
			"OpenRouter is a developer API with a bare chatroom. LLM Gateway Chat is a polished $19/mo subscription with media generation and monthly credits.",
		eyebrow: "Metered dev tool vs consumer subscription",
		verdict:
			"OpenRouter is the developer's model marketplace — 400+ models behind one API, zero markup on inference, pay-as-you-go credits. Its chatroom exists, but it's a bare playground with local-only history and no consumer subscription. LLM Gateway Chat is the opposite end: a polished chat app with a real monthly subscription, media generation, and credits at 2.5× value.",
		usPrice: "$19/mo",
		themPrice: "Pay-as-you-go",
		table: [
			{
				label: "Product type",
				us: "Consumer chat app with a subscription",
				them: "Developer API marketplace; chatroom is secondary",
			},
			{
				label: "Models",
				us: "200+ across every major provider",
				them: "400+ models from many providers",
			},
			{
				label: "How you pay",
				us: "$19/mo subscription — credits at 2.5× value, reset monthly",
				them: "Prepaid credits that deplete; a purchase fee applies",
			},
			{
				label: "Chat experience",
				us: "Polished — persistent, shareable, media-rich",
				them: "Basic chatroom; history stored locally only",
				usWins: true,
			},
			{
				label: "Media generation",
				us: "Image, video, and audio built in",
				them: "Image in chatroom; video is API-only",
			},
			{
				label: "Cross-device sync",
				us: "Yes — conversations follow you",
				them: "No — chatroom history is local to the browser",
				usWins: true,
			},
			{
				label: "Group / side-by-side",
				us: "Yes — group chat",
				them: "Compare models in the chatroom",
			},
			{
				label: "Best for",
				us: "People who want to chat",
				them: "Developers who want one API key",
			},
		],
		sections: [
			{
				heading: "What it actually is",
				us: "LLM Gateway Chat is a consumer product: you subscribe, you chat, your conversations persist and sync, and you get image, video, and audio generation in the same place.",
				them: "OpenRouter is an API marketplace first. Its chatroom is a thin playground for trying models — useful, but history is local to your browser, there's no subscription, and it's not built as a daily chat app.",
				bottomLine:
					"Want one API key for your code? OpenRouter is great. Want a chat app? That's us.",
			},
			{
				heading: "How you pay",
				us: "A $19/mo subscription turns into $47.50 of credits at provider rates that reset monthly, with pay-as-you-go top-ups as a fallback.",
				them: "Prepaid credits with no markup on inference, but a fee applies when you buy them, and the balance simply depletes — there's no monthly allowance or 2.5× value, and costs are harder to predict for non-technical users.",
				bottomLine:
					"OpenRouter's per-token economics are great for developers; a subscription with monthly value is friendlier for chatting.",
			},
			{
				heading: "Breadth",
				us: "200+ first-party models with a polished, persistent, media-capable interface.",
				them: "More raw models — 400+ — and zero inference markup, which genuinely matters if you're building software on the API.",
				bottomLine:
					"For sheer model count and API economics, OpenRouter leads; for the chat experience, LLM Gateway Chat does.",
			},
		],
		chooseThem: [
			"You're a developer who wants one API across every model",
			"You want zero markup on inference for your app",
			"You only need a quick playground to test models",
		],
		chooseUs: [
			"You want a real chat app, not an API console",
			"You want conversations that persist and sync across devices",
			"You want a monthly subscription with credits at 2.5× value",
			"You want image, video, and audio generation built in",
		],
		switchHeading: "Looking for an OpenRouter alternative for chatting?",
		whySwitch: [
			"The chatroom is too bare for daily use",
			"Your history is stuck in one browser with no sync",
			"You'd rather a monthly subscription than a depleting balance",
			"You want media generation and a polished interface",
		],
		migration:
			"If you've been using OpenRouter's chatroom because you wanted every model in one place, LLM Gateway Chat gives you that as an actual product — persistent, syncing conversations, media generation, and a subscription with monthly credit value. OpenRouter stays the better choice when you're building on the API.",
		faq: [
			{
				q: "Is LLM Gateway Chat like OpenRouter?",
				a: "They share the 'every model on one balance' idea, but OpenRouter is a developer API marketplace whose chatroom is a secondary playground. LLM Gateway Chat is a consumer chat app with a subscription, persistent syncing conversations, and built-in media generation.",
			},
			{
				q: "Does it have more models than OpenRouter?",
				a: "OpenRouter lists more raw models — 400+ versus 200+ — and has zero inference markup for API developers. For chatting, LLM Gateway Chat focuses on a polished experience across every major provider.",
			},
			{
				q: "Why pay a subscription instead of OpenRouter's pay-as-you-go?",
				a: "The $19/mo subscription gives you 2.5× credit value that resets monthly plus a top-up fallback, which is more predictable for daily chatting than a depleting prepaid balance with a purchase fee.",
			},
			{
				q: "Do my OpenRouter chatroom conversations sync?",
				a: "On OpenRouter the chatroom stores history locally in your browser. LLM Gateway Chat persists and syncs conversations across devices, and lets you share read-only links.",
			},
		],
	},
];

export function getComparison(slug: string): Comparison | undefined {
	return comparisons.find((c) => c.slug === slug);
}

export function getComparisonSlugs(): string[] {
	return comparisons.map((c) => c.slug);
}
