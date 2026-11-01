/**
 * Comparison pages for the Lounge studios (video, image, audio, voice calls,
 * decisions and Sandbox Escape). Lounge rates come from the model catalogue,
 * so a price change in packages/models updates every table here. Competitor
 * rates are copied from their own pricing pages on the date in each table.
 *
 * Same tone rule as the chat pages: name what the competitor does better.
 */

import {
	imageAtResolution,
	liveRate,
	perCharacter,
	perImage,
	perInputAudioToken,
	perInputToken,
	perOutputAudioToken,
	perSecond,
	studioModelCount,
} from "@/lib/catalogue-rates";

import type { Comparison, ModelPriceRow } from "@/lib/comparisons";

const CHECKED_ON = "October 31, 2026";

const videoModels = studioModelCount("video");
const imageModels = studioModelCount("image");
const audioModels = studioModelCount("audio");
const callModels = studioModelCount("calls");
const decisionModels = studioModelCount("decisions");

function scaled(rate: number | null, factor: number): number | null {
	return rate === null ? null : rate * factor;
}

function served(rows: ModelPriceRow[]): ModelPriceRow[] {
	return rows.filter((row) => row.us !== null || row.usLabel !== undefined);
}

/** Higgsfield's Plus plan, monthly billing: $59 for 1,200 credits. */
const HIGGSFIELD_PLUS_CREDIT = 0.0492;

function higgsfieldPerSecond(credits: number, seconds: number): number {
	return (credits * HIGGSFIELD_PLUS_CREDIT) / seconds;
}

/** Krea Pro: $21 a month billed annually, divided by Krea's image count. */
const KREA_PRO_MONTHLY = 21;

function kreaPerImage(imagesOnPro: number): number {
	return KREA_PRO_MONTHLY / imagesOnPro;
}

const NANO_BANANA_2_1 = () =>
	liveRate("gemini-nano-banana-2.1", imageAtResolution("1K"));
const NANO_BANANA_PRO = () =>
	liveRate("gemini-3-pro-image", imageAtResolution("1K"));
const GROK_IMAGINE_2 = () =>
	liveRate("grok-imagine-image-2-0", perImage("low/1k"));
const QWEN_IMAGE_3 = () => liveRate("qwen-image-3.0", perImage("default"));
const MUSE_IMAGE = () => liveRate("muse-image-1.0", perImage("default"));

const perThousandCharacters = (modelId: string) =>
	scaled(liveRate(modelId, perCharacter), 1000);

const perMillion = (
	modelId: string,
	read: Parameters<typeof liveRate>[1],
): number | null => scaled(liveRate(modelId, read), 1_000_000);

export const studioComparisons: Comparison[] = [
	{
		slug: "higgsfield",
		studio: "video",
		competitor: "Higgsfield",
		competitorFull: "Higgsfield AI",
		competitorTagline: "A creator studio that resells video models for credits",
		category: "aggregator",
		metaTitle: "Lounge Video Studio vs Higgsfield — per-second video pricing",
		metaDescription:
			"Higgsfield sells video in credits that expire. Lounge Video Studio runs Veo, Kling, Seedance and more at the provider's per-second rate, from $9/mo.",
		eyebrow: "Credits per clip vs provider rates per second",
		verdict:
			"Higgsfield wraps third-party models (Seedance, Kling, Wan, Veo) in creator tools of its own: Cinema Studio, effect presets, Soul ID characters and Speak lip sync. You pay in credits set per model, resolution and duration, from $19 for 270 credits, and unused credits are lost at renewal. Lounge Video Studio bills every second at the provider's list rate, and a $19 Plus membership buys $47.50 of it. On the models both carry, a Lounge second costs less.",
		usPrice: "From $9/mo",
		themPrice: "From $19/mo",
		table: [
			{
				label: "How video is billed",
				us: "Per second, at the provider's list rate",
				them: "Credits, set per model, resolution and duration",
				usWins: true,
			},
			{
				label: "Entry plan",
				us: "$9 Starter: $18 of credits, every video model included",
				them: "$19 Starter: 270 credits. The free plan has no credits",
				usWins: true,
			},
			{
				label: "Around $20 a month",
				us: "$19 Plus: $47.50 of credits",
				them: "$59 Plus ($47 billed annually): 1,200 credits",
				usWins: true,
			},
			{
				label: "Unused credits",
				us: "Plan credits reset monthly; pay-as-you-go top-ups never expire",
				them: "Plan credits reset at renewal; credit packs expire after 90 days",
				usWins: true,
			},
			{
				label: "Video models",
				us: `${videoModels} models, incl. Veo 3.1, Kling 3.0, Seedance 2.5, Grok Imagine, MiniMax H3 and Wan 2.6`,
				them: "Seedance, Kling, Wan, Veo and Higgsfield's Cinema Studio",
			},
			{
				label: "Generation controls",
				us: "Resolution, aspect ratio, duration, audio, first and last frame, reference media",
				them: "Cinema Studio, effect presets, Soul ID characters, Speak lip sync",
			},
			{
				label: "Cost before you generate",
				us: "Estimate shown next to Generate, summed across every model you compare",
				them: "A credit rate per model, resolution and duration",
			},
			{
				label: "Beyond video",
				us: "Chat with 200+ models, image, audio, voice calls on the same credits",
				them: "Image and audio tools; chat through its ChatGPT plugin",
				usWins: true,
			},
		],
		sections: [
			{
				heading: "Pricing",
				us: "Lounge charges what the provider charges per second of output. The cost estimate sits next to the Generate button, summed across every model you compare, before anything runs. Memberships stretch it: Starter doubles $9 into $18 of credits, Plus turns $19 into $47.50 and Pro turns $49 into $147.",
				them: "Each Higgsfield model has its own credit rate per resolution and duration. Seedance 2.0 takes 23 credits for five seconds at 720p and 45 at 1080p; Kling 3.0 takes 10 and 12.5. A credit costs between $0.033 (Ultra, annual) and $0.07 (Starter), and re-rolls cost full price.",
				bottomLine:
					"Lounge if you want to see the per-second price; Higgsfield if you'd rather think in clips and buy a yearly plan.",
			},
			{
				heading: "Models and tools",
				us: "Every video model in the LLM Gateway catalogue, with controls that adapt to each model: only the durations, resolutions and frame inputs the model accepts are offered. Compare mode runs one prompt on several models at once.",
				them: "Higgsfield adds its own layer on top of the models it resells: Cinema Studio for cinematic shots, a library of effects, Soul ID for consistent characters, and Speak for lip-synced presenters. Some models are periodically \u201cUnlimited\u201d and deduct no credits for a set window.",
				bottomLine:
					"Higgsfield for presets and character tools; Lounge for raw model access and side-by-side tests.",
			},
			{
				heading: "One account for everything else",
				us: "The credits that pay for video also pay for chat with 200+ models, Image Studio, Audio Studio and Sandbox Escape. The same models are on the LLM Gateway API when you move from testing to shipping.",
				them: "Higgsfield covers image, video and audio generation and offers an API console and MCP access; general-purpose chat happens in ChatGPT through its plugin.",
				bottomLine: "Lounge if video is one of several things you use AI for.",
			},
		],
		chooseThem: [
			"You want Cinema Studio, effect presets and camera-style shots out of the box",
			"You need consistent characters (Soul ID) or lip-synced presenters (Speak)",
			"You work inside an \u201cUnlimited\u201d window for a model you use heavily",
			"You prefer paying yearly for a fixed credit pool",
		],
		chooseUs: [
			"You want to pay the provider's per-second rate, not a credit conversion",
			"You compare Veo, Kling and Seedance on the same prompt before committing",
			"You need first and last frames, reference media and audio toggles per model",
			"You also use chat, image and audio models and want one balance",
			"You want top-ups that never expire",
		],
		switchHeading: "Looking for a Higgsfield alternative?",
		whySwitch: [
			"Credits you didn't use disappeared at renewal",
			"Re-rolls burned through a month of credits in a weekend",
			"You can't tell what a second of video actually costs",
			"You pay for a separate chat subscription anyway",
		],
		migration:
			"There's nothing to import. Open Video Studio, pick the model you used on Higgsfield (Seedance, Kling, Veo), paste the same prompt and compare it against two others in one run. Starter at $9/mo already includes every video model.",
		faq: [
			{
				q: "Is Lounge cheaper than Higgsfield for video?",
				a: "On the models both offer, yes. At Higgsfield's Plus rate ($0.0492 per credit), a second of Seedance 2.0 at 720p costs about $0.23; Lounge charges ByteDance's $0.15 list rate, or about $0.06 of a $19 Plus membership.",
			},
			{
				q: "Do Lounge credits expire?",
				a: "Membership credits reset each month. Pay-as-you-go top-ups never expire and are used once the membership allowance runs out.",
			},
			{
				q: "Does Lounge have Higgsfield's presets and effects?",
				a: "No. Lounge exposes each model's own controls (resolution, aspect ratio, duration, audio, frames and reference media) rather than a preset library.",
			},
			{
				q: "Can I use the same video models from code?",
				a: "Yes. Every model in Video Studio is available on the LLM Gateway API with the same per-second pricing.",
			},
		],
		modelPricing: {
			heading: "Same model, cost per second",
			intro:
				"Higgsfield prices in credits; we converted its published rates for five-second clips at $0.0492 per credit (Plus, billed monthly). Lounge shows the provider's list rate.",
			unit: "per second",
			rows: served([
				{
					model: "Seedance 2.0 · 720p",
					us: liveRate("seedance-2-0", perSecond("default_audio")),
					them: higgsfieldPerSecond(23, 5),
				},
				{
					model: "Seedance 2.0 · 1080p",
					us: liveRate("seedance-2-0", perSecond("1080p_audio")),
					them: higgsfieldPerSecond(45, 5),
				},
				{
					model: "Kling 3.0 · 720p",
					us: liveRate("kling-v3-0", perSecond("720p_video")),
					them: higgsfieldPerSecond(10, 5),
				},
				{
					model: "Kling 3.0 · 1080p",
					us: liveRate("kling-v3-0", perSecond("1080p_video")),
					them: higgsfieldPerSecond(12.5, 5),
				},
			]),
			sources: [
				{
					label:
						"Higgsfield credit rates, as published in Krea's pricing breakdown",
					url: "https://www.krea.ai/blog/higgsfield-pricing-explained-2026-unlimited-credits-and-real-monthly-costs",
				},
			],
			checkedOn: CHECKED_ON,
		},
	},
	{
		slug: "fal",
		studio: "video",
		competitor: "fal",
		competitorFull: "fal.ai",
		competitorTagline: "A developer API for generative media models",
		category: "developer",
		metaTitle: "Lounge Video Studio vs fal — Veo, Kling & Seedance prices",
		metaDescription:
			"fal is a media API for developers. Lounge Video Studio runs the same video models in a browser studio, at equal or lower per-second rates.",
		eyebrow: "A studio vs an API",
		verdict:
			"fal is an inference platform for developers: hundreds of model endpoints, output-based pricing and serverless GPUs from $2.49/h. You call it from code. Lounge Video Studio is where you make the video: pick models, set resolution, duration, audio and frames, compare results side by side and keep your history. On the models both carry, Lounge's per-second rate matches or beats fal's, and a membership stretches it further.",
		usPrice: "From $9/mo",
		themPrice: "Pay per use",
		table: [
			{
				label: "Built for",
				us: "Making and comparing videos in the browser or on iOS",
				them: "Developers calling model endpoints from code",
			},
			{
				label: "Interface",
				us: "Studio with model picker, adaptive settings, compare mode and history",
				them: "Per-model playground pages and API docs",
				usWins: true,
			},
			{
				label: "How video is billed",
				us: "Per second at the provider's list rate",
				them: "Per second or per video, depending on the model",
			},
			{
				label: "Subscription value",
				us: "Plus: $19 buys $47.50 of credits",
				them: "No subscription; usage is billed at list rate",
				usWins: true,
			},
			{
				label: "Video models",
				us: `${videoModels} models, incl. Veo 3.1, Kling 3.0, Seedance 2.5, Grok Imagine, MiniMax H3 and Wan 2.6`,
				them: "A large catalogue of video endpoints, including open-weight models",
			},
			{
				label: "Custom models",
				us: "Catalogue models only",
				them: "Deploy your own on serverless GPUs, H100 from $2.49/h",
			},
			{
				label: "Same models over an API",
				us: "Yes, through the LLM Gateway API",
				them: "Yes, that's the product",
			},
			{
				label: "Beyond media",
				us: "Chat with 200+ models, voice calls, decisions",
				them: "Image, audio, 3D and custom model APIs",
			},
		],
		sections: [
			{
				heading: "Pricing",
				us: "Lounge charges the provider's list rate per second, and the estimate is shown before you generate. Veo 3.1, Veo 3.1 Fast and Kling 3.0 Pro cost the same as on fal; Seedance 2.0 and Wan 2.6 cost less. Memberships turn $9, $19 and $49 into $18, $47.50 and $147 of credits.",
				them: "fal bills by output unit. Veo 3.1 is $0.40 a second with audio at 720p or 1080p, Seedance 2.0 is $0.30 a second at 720p, Kling 3.0 Pro is $0.168 a second with audio. There is no subscription discount, and the H100 GPU fleet starts at $2.49/h for custom deployments.",
				bottomLine:
					"Equal or lower list prices on Lounge for the overlapping models; fal if you need a model only it hosts.",
			},
			{
				heading: "Workflow",
				us: "Settings adapt to each model: only valid resolution and aspect ratio pairs, supported durations, audio toggles and first, last or reference frames. Compare mode runs one prompt on several models. Jobs keep running in the background and land in your history.",
				them: "Each fal model has its own page with a playground form and code samples. It's the right shape for wiring a model into an app, less so for iterating on a shot across models.",
				bottomLine:
					"Lounge for creative iteration; fal for production pipelines.",
			},
			{
				heading: "Breadth",
				us: "A curated catalogue across video, image, audio, chat and voice, with the same models on the LLM Gateway API.",
				them: "fal hosts a very wide catalogue, including niche and open-weight models, and lets you deploy your own code on its GPUs.",
				bottomLine: "fal if you need the long tail or custom deployments.",
			},
		],
		chooseThem: [
			"You're building an app and want a model endpoint, not a studio",
			"You need a model or variant that only fal hosts",
			"You deploy your own models on serverless GPUs",
			"You want 3D and other niche media endpoints in one place",
		],
		chooseUs: [
			"You want a studio to iterate on shots, not an API form",
			"You compare Veo, Kling and Seedance side by side before choosing",
			"You want a membership that stretches the same per-second rates 2–3×",
			"You also chat, generate images and speech, or take voice calls",
		],
		switchHeading: "Looking for a fal alternative for video?",
		whySwitch: [
			"You were testing prompts in API playground forms",
			"You want history and side-by-side results without writing code",
			"You pay list price on every second",
			"Your team needs a UI as well as an API",
		],
		migration:
			"Use the same model names you used on fal: Veo 3.1, Kling 3.0, Seedance 2.0, Wan 2.6. Open Video Studio, pick up to three models and run the prompt. When you're ready to automate, the LLM Gateway API serves the same models.",
		faq: [
			{
				q: "Is Lounge cheaper than fal for Veo 3.1?",
				a: "It's the same list rate: $0.40 a second with audio and $0.20 without at 720p or 1080p. On a $19 Plus membership the same second costs $0.16 of what you paid.",
			},
			{
				q: "Which models are cheaper on Lounge than fal?",
				a: "Seedance 2.0 ($0.15 vs $0.30 a second at 720p) and Wan 2.6 ($0.08 vs $0.10 at 720p) at the time of writing. Veo 3.1, Veo 3.1 Fast, Kling 3.0 Pro and MiniMax H3 Max match.",
			},
			{
				q: "Can I call these models from code?",
				a: "Yes. The LLM Gateway API serves every model in Video Studio at the same per-second pricing.",
			},
			{
				q: "Does Lounge host custom models?",
				a: "No. Lounge runs the LLM Gateway catalogue. If you need to deploy your own weights, fal's serverless GPUs are built for that.",
			},
		],
		modelPricing: {
			heading: "Same model, cost per second",
			intro:
				"fal's per-second rates from each model's page; Lounge's from the provider's list rate in our catalogue.",
			unit: "per second",
			rows: served([
				{
					model: "Veo 3.1 · 1080p with audio",
					us: liveRate("veo-3.1-generate-preview", perSecond("default_audio")),
					them: 0.4,
				},
				{
					model: "Veo 3.1 · 1080p, no audio",
					us: liveRate("veo-3.1-generate-preview", perSecond("default_video")),
					them: 0.2,
				},
				{
					model: "Veo 3.1 Fast · 1080p with audio",
					us: liveRate(
						"veo-3.1-fast-generate-preview",
						perSecond("default_audio"),
					),
					them: 0.15,
				},
				{
					model: "Kling 3.0 Pro · with audio",
					us: liveRate("kling-v3-0-pro", perSecond("default_audio")),
					them: 0.168,
				},
				{
					model: "Kling 3.0 Pro · no audio",
					us: liveRate("kling-v3-0-pro", perSecond("default_video")),
					them: 0.112,
				},
				{
					model: "Seedance 2.0 · 720p",
					us: liveRate("seedance-2-0", perSecond("default_audio")),
					them: 0.3034,
				},
				{
					model: "Seedance 2.0 · 1080p",
					us: liveRate("seedance-2-0", perSecond("1080p_audio")),
					them: 0.682,
				},
				{
					model: "Wan 2.6 · 720p",
					us: liveRate("wan-2-6-t2v", perSecond("720p")),
					them: 0.1,
				},
				{
					model: "Wan 2.6 · 1080p",
					us: liveRate("wan-2-6-t2v", perSecond("1080p")),
					them: 0.15,
				},
				{
					model: "MiniMax H3 Max · 768p",
					us: liveRate("minimax-h3-max", perSecond("768p")),
					them: 0.08,
				},
			]),
			sources: [
				{
					label: "fal model pages (standard rates, promotions excluded)",
					url: "https://fal.ai/pricing",
				},
			],
			checkedOn: CHECKED_ON,
		},
	},
	{
		slug: "elevenlabs",
		studio: "audio",
		competitor: "ElevenLabs",
		competitorFull: "ElevenLabs",
		competitorTagline: "The voice specialist: TTS, cloning, dubbing, agents",
		category: "single-vendor",
		metaTitle: "Lounge Audio Studio vs ElevenLabs — compare TTS voices",
		metaDescription:
			"ElevenLabs is the deepest voice product. Lounge Audio Studio puts ElevenLabs next to Qwen and other TTS models, on the credits you use for chat.",
		eyebrow: "One voice vendor vs every TTS model",
		verdict:
			"ElevenLabs is the most complete voice product: instant and professional voice cloning, voice design, dubbing, music, sound effects and voice agents, and its own API rate is lower than Lounge's pay-as-you-go rate for the same models. Lounge Audio Studio is for choosing a voice model: send the same text to ElevenLabs, Qwen and other TTS models side by side, then keep speech on the same credits as chat, image and video. On a membership, ElevenLabs voices cost less per character than on ElevenLabs' own API.",
		usPrice: "From $9/mo",
		themPrice: "From $6/mo",
		table: [
			{
				label: "Voice models",
				us: `${audioModels} TTS models, incl. Eleven v3, Multilingual v2, Flash v2.5, Turbo v2.5 and Qwen 3.0 TTS`,
				them: "ElevenLabs models only (v4, v3, Multilingual v2, Flash and Turbo)",
				usWins: true,
			},
			{
				label: "Compare models",
				us: "Same text to several models at once, up to four on iOS",
				them: "Within ElevenLabs' own models",
				usWins: true,
			},
			{
				label: "Voice cloning and design",
				us: "Each model's own voice roster",
				them: "Instant cloning from Starter, professional cloning from Creator, voice design",
			},
			{
				label: "Dubbing, music, sound effects",
				us: "Not offered",
				them: "Included",
			},
			{
				label: "Plans",
				us: "$9 / $19 / $49, credits shared with chat, image and video",
				them: "Free (10k credits), Starter $6, Creator $22, Pro $99 per month",
			},
			{
				label: "Eleven v3, pay as you go",
				us: "$0.11 per 1K characters",
				them: "$0.08 per 1K characters on the API",
			},
			{
				label: "Eleven v3, on a membership",
				us: "About $0.044 per 1K characters on Plus",
				them: "Included in plan credits",
				usWins: true,
			},
			{
				label: "Beyond voice",
				us: "Chat with 200+ models, image, video, voice calls",
				them: "Speech to text, agents, image and video",
			},
		],
		sections: [
			{
				heading: "Pricing",
				us: "Lounge bills characters at the catalogue rate: $0.11 per 1K for Eleven v3 and Multilingual v2, $0.055 for Flash and Turbo v2.5, and $0.015–$0.02 for Qwen 3.0 TTS. A $19 Plus membership buys $47.50 of credits, which puts Eleven v3 at about $0.044 per 1K.",
				them: "ElevenLabs' API charges $0.08 per 1K characters for v4, v3 and Multilingual v2 and $0.04 for Flash and Turbo. Creative plans run from a free 10k-credit tier through Starter ($6), Creator ($22) and Pro ($99) per month.",
				bottomLine:
					"ElevenLabs direct for pay-as-you-go ElevenLabs-only usage; Lounge on a membership, or when you mix providers.",
			},
			{
				heading: "Choosing a voice",
				us: "Audio Studio sends one text to several models and plays the results side by side, with each model's voices, formats and, on iOS, speed and delivery instructions. History is shared between web and iOS.",
				them: "ElevenLabs' voice library is the largest around, and you can clone or design voices. You only hear ElevenLabs models, though.",
				bottomLine:
					"Lounge to pick a provider; ElevenLabs once you know you want its voices.",
			},
			{
				heading: "Production features",
				us: "Lounge is a studio for text to speech plus the LLM Gateway Speech API with the same models. It has no dubbing, music or cloning.",
				them: "Dubbing Studio, Projects, music, sound effects, voice isolation and conversational agents. For audio production work it's the deeper tool.",
				bottomLine:
					"ElevenLabs for audio production; Lounge for TTS selection and mixed workloads.",
			},
		],
		chooseThem: [
			"You need voice cloning or voice design",
			"You dub videos or produce audiobooks in Projects",
			"You want music, sound effects and voice isolation in one place",
			"You only use ElevenLabs models and pay as you go",
		],
		chooseUs: [
			"You want to compare ElevenLabs against Qwen and other TTS models on one text",
			"You want speech on the same credits as chat, image and video",
			"You're on a membership and want ElevenLabs voices below their API list rate",
			"You'll ship through the LLM Gateway Speech API afterwards",
		],
		switchHeading: "Looking for an ElevenLabs alternative?",
		whySwitch: [
			"You want to hear other providers before committing to one",
			"A cheaper TTS model is good enough for part of your workload",
			"You already pay for chat and image tools separately",
			"You want one bill for every AI model you use",
		],
		migration:
			"Eleven v3, Multilingual v2, Flash v2.5 and Turbo v2.5 are all in Audio Studio, so you can keep the voices you know. Turn on comparison mode, add a Qwen model next to them and listen.",
		faq: [
			{
				q: "Can I use ElevenLabs voices in Lounge?",
				a: "Yes. Eleven v3, Multilingual v2, Flash v2.5 and Turbo v2.5 are in Audio Studio with their own voice rosters.",
			},
			{
				q: "Is Lounge cheaper than ElevenLabs?",
				a: "Not pay as you go: ElevenLabs' API is $0.08 per 1K characters for v3, Lounge is $0.11. On a $19 Plus membership the same 1K characters cost about $0.044 of what you paid.",
			},
			{
				q: "Does Lounge support voice cloning?",
				a: "No. Lounge uses each model's built-in voices. ElevenLabs is the better choice for cloning and voice design.",
			},
		],
		modelPricing: {
			heading: "Same model, cost per 1K characters",
			intro:
				"ElevenLabs' pay-as-you-go API rates against Lounge's catalogue rate. The Plus column is what the same characters cost out of a $19 membership.",
			unit: "per 1K characters",
			rows: served([
				{
					model: "Eleven v3",
					us: perThousandCharacters("eleven-v3"),
					them: 0.08,
				},
				{
					model: "Eleven Multilingual v2",
					us: perThousandCharacters("eleven-multilingual-v2"),
					them: 0.08,
				},
				{
					model: "Eleven Flash v2.5",
					us: perThousandCharacters("eleven-flash-v2-5"),
					them: 0.04,
				},
				{
					model: "Eleven Turbo v2.5",
					us: perThousandCharacters("eleven-turbo-v2-5"),
					them: 0.04,
				},
				{
					model: "Qwen 3.0 TTS Plus",
					us: perThousandCharacters("qwen-audio-3.0-tts-plus"),
					them: null,
					themLabel: "Not offered",
				},
				{
					model: "Qwen 3.0 TTS Flash",
					us: perThousandCharacters("qwen-audio-3.0-tts-flash"),
					them: null,
					themLabel: "Not offered",
				},
			]),
			sources: [
				{
					label: "ElevenLabs API pricing",
					url: "https://elevenlabs.io/pricing/api",
				},
			],
			checkedOn: CHECKED_ON,
		},
	},
	{
		slug: "midjourney",
		studio: "image",
		competitor: "Midjourney",
		competitorFull: "Midjourney",
		competitorTagline:
			"One house model with a signature look, sold by GPU time",
		category: "single-vendor",
		metaTitle: "Lounge Image Studio vs Midjourney — every image model",
		metaDescription:
			"Midjourney is one model sold by GPU hours. Lounge Image Studio runs GPT Image, Nano Banana, Seedream, Grok Imagine and more, billed per image from $9/mo.",
		eyebrow: "One aesthetic vs every image model",
		verdict:
			"Midjourney has a look people recognize and a mature community, and from $30 Standard it generates unlimited images in Relax mode. It's also one model family, metered in GPU time: Basic is $10 for 3.3 fast hours, and Stealth mode needs Pro at $60. Lounge Image Studio runs GPT Image, Nano Banana, Seedream, Grok Imagine, Qwen Image and more, bills each image at the provider's rate, and lets you compare models on the same prompt.",
		usPrice: "From $9/mo",
		themPrice: "From $10/mo",
		table: [
			{
				label: "Image models",
				us: `${imageModels} models from OpenAI, Google, ByteDance, xAI, Alibaba, Meta and more`,
				them: "Midjourney's own models",
				usWins: true,
			},
			{
				label: "How images are billed",
				us: "Per image at the provider's rate",
				them: "Fast GPU hours per month, extra hours $4 each",
			},
			{
				label: "Entry plan",
				us: "$9 Starter: $18 of credits, every image model",
				them: "$10 Basic: 3.3 fast GPU hours",
			},
			{
				label: "Unlimited generation",
				us: "No, every image is billed",
				them: "Unlimited Relax images from $30 Standard",
			},
			{
				label: "Compare models",
				us: "Same prompt on several models side by side",
				them: "Not applicable: one model family",
				usWins: true,
			},
			{
				label: "Images per prompt",
				us: "1 to 4, with resolutions up to 4K where the model supports it",
				them: "A grid of variations per job",
			},
			{
				label: "Annual discount",
				us: "Monthly only",
				them: "20% off annual plans",
			},
			{
				label: "Beyond images",
				us: "Chat with 200+ models, video, audio, voice calls",
				them: "Video generation; HD from Standard",
			},
		],
		sections: [
			{
				heading: "Models",
				us: "Image Studio lists every image model in the catalogue: GPT Image 2 and 2.5, Nano Banana, Gemini Pro Image, Seedream 5.0, Grok Imagine Image 2.0, Qwen Image, Muse Image and more. Different models win at text rendering, photorealism or editing, and you can test them on one prompt.",
				them: "Midjourney is one model family with a strong, consistent aesthetic and style controls tuned for it. If that look is what you want, nothing else quite reproduces it.",
				bottomLine:
					"Midjourney for its signature style; Lounge to pick the best model per job.",
			},
			{
				heading: "Pricing",
				us: "You pay per image at the provider's rate, and Flex-tier models cost about half. A $19 Plus membership buys $47.50 of credits, shared with chat, video and audio.",
				them: "Basic $10 (3.3 fast hours), Standard $30 (15 hours plus unlimited Relax images), Pro $60 (30 hours, Stealth mode), Mega $120 (60 hours). Annual billing saves 20%. Companies over $1M in revenue need Pro or Mega.",
				bottomLine:
					"Midjourney Standard for very high volume in one style; Lounge for varied or occasional work.",
			},
			{
				heading: "Privacy and workflow",
				us: "Generations land in your Image Studio history, previews stay responsive at 4K, and Download all bundles a batch into one zip.",
				them: "Images are visible in the community gallery unless you're on Pro or Mega with Stealth mode.",
				bottomLine:
					"Lounge if you don't want to pay $60 a month for private generations.",
			},
		],
		chooseThem: [
			"You want Midjourney's specific aesthetic",
			"You generate hundreds of images a month and Relax mode's queue is fine",
			"You value its community, style references and moodboards",
			"You're happy to pay yearly for 20% off",
		],
		chooseUs: [
			"You want GPT Image, Nano Banana, Seedream and Grok Imagine in one place",
			"You compare models on the same prompt",
			"You want to pay per image instead of per GPU hour",
			"You also want chat, video and audio models on the same credits",
		],
		switchHeading: "Looking for a Midjourney alternative?",
		whySwitch: [
			"You need accurate text in images",
			"You want private generations without paying for Pro",
			"One aesthetic doesn't fit every project",
			"You run out of fast hours mid-month",
		],
		migration:
			"Paste your Midjourney prompt into Image Studio and run it on three models at once to see which one gets closest. Starter at $9/mo includes every image model.",
		faq: [
			{
				q: "Does Lounge have Midjourney's models?",
				a: "No. Midjourney's models are only available through Midjourney. Lounge runs models from OpenAI, Google, ByteDance, xAI, Alibaba, Meta and others.",
			},
			{
				q: "Is Midjourney cheaper per image?",
				a: "If you use your whole plan, yes: Basic's 200 fast minutes come to about $0.0125 an image. Lounge's models run from about $0.01 (Muse Image) to $0.13 (Nano Banana Pro at 1K) per image, less on a membership.",
			},
			{
				q: "Is there an unlimited plan?",
				a: "No. Lounge bills each image at the provider's rate. Midjourney's Relax mode is the better fit for unlimited, slower generation.",
			},
			{
				q: "Which plan includes image models?",
				a: "Every membership, including the $9 Starter, includes every image, video and audio model.",
			},
		],
		modelPricing: {
			heading: "What an image costs",
			intro:
				"Midjourney sells GPU time. One image prompt takes about a minute and returns a grid of four, so Basic's 200 fast minutes work out to about $0.0125 an image if you use them all. Lounge bills each image at the model's own rate.",
			unit: "per image",
			rows: served([
				{
					model: "Midjourney · Basic fast time",
					us: null,
					usLabel: "Not offered",
					them: 10 / 200 / 4,
				},
				{
					model: "Midjourney · extra fast time ($4/h)",
					us: null,
					usLabel: "Not offered",
					them: 4 / 60 / 4,
				},
				{
					model: "Nano Banana 2.1 · 1K",
					us: NANO_BANANA_2_1(),
					them: null,
					themLabel: "Not offered",
				},
				{
					model: "Nano Banana Pro · 1K",
					us: NANO_BANANA_PRO(),
					them: null,
					themLabel: "Not offered",
				},
				{
					model: "Grok Imagine Image 2.0 · 1K, low",
					us: GROK_IMAGINE_2(),
					them: null,
					themLabel: "Not offered",
				},
				{
					model: "Qwen Image 3.0",
					us: QWEN_IMAGE_3(),
					them: null,
					themLabel: "Not offered",
				},
				{
					model: "Muse Image 1.0",
					us: MUSE_IMAGE(),
					them: null,
					themLabel: "Not offered",
				},
			]),
			sources: [
				{
					label: "Midjourney plans",
					url: "https://docs.midjourney.com/hc/en-us/articles/27870484040333-Comparing-Midjourney-Plans",
				},
				{
					label: "GPU time per prompt",
					url: "https://docs.midjourney.com/hc/en-us/articles/32016412137741",
				},
			],
			checkedOn: CHECKED_ON,
		},
	},
	{
		slug: "krea",
		studio: "image",
		competitor: "Krea",
		competitorFull: "Krea AI",
		competitorTagline: "A creative suite with its own models and compute units",
		category: "aggregator",
		metaTitle: "Lounge Image Studio vs Krea — image models compared",
		metaDescription:
			"Krea bundles image, video, real-time and 3D tools into compute units. Lounge Image Studio bills each image at the provider's rate and shares credits with chat.",
		eyebrow: "Compute units vs provider rates",
		verdict:
			"Krea is a broad creative suite: its own Krea models plus FLUX, GPT Image, Nano Banana, Ideogram and others, real-time generation, LoRA training, 3D, lip sync, Nodes and an app builder, paid in compute units from $5.25/mo on annual billing. Lounge Image Studio does one thing: run the image models in the LLM Gateway catalogue at the provider's per-image rate, side by side, on the same credits as chat, video and audio.",
		usPrice: "From $9/mo",
		themPrice: "From $5.25/mo (annual)",
		table: [
			{
				label: "Image models",
				us: `${imageModels} models from OpenAI, Google, ByteDance, xAI, Alibaba, Meta and more`,
				them: "Krea 1–3 plus FLUX, GPT Image, Nano Banana, Ideogram, Luma and others",
			},
			{
				label: "How images are billed",
				us: "Per image at the provider's rate",
				them: "Compute units, a different amount per model",
				usWins: true,
			},
			{
				label: "Plans",
				us: "$9 / $19 / $49 monthly",
				them: "Free, Basic $5.25, Pro $21, Max $63, Business $160 (billed annually)",
			},
			{
				label: "Extra usage",
				us: "Top-ups that never expire",
				them: "Compute packs that expire after 90 days",
				usWins: true,
			},
			{
				label: "Real-time, 3D, LoRA training",
				us: "Not offered",
				them: "Included on paid plans",
			},
			{
				label: "Node workflows",
				us: "Not offered",
				them: "Krea Nodes and App Builder",
			},
			{
				label: "Beyond images",
				us: "Chat with 200+ models, voice calls, decisions",
				them: "Video, real-time, 3D and lip sync",
			},
		],
		sections: [
			{
				heading: "Pricing",
				us: "Each image costs what the provider charges for it, at the resolution and quality you pick; Flex-tier models cost about half. Memberships turn $9, $19 and $49 into $18, $47.50 and $147 of credits, and top-ups never expire.",
				them: "Krea's plans are priced in compute units. Annual billing saves 40%, putting Basic at $5.25 and Pro at $21 a month, and each model draws a different number of units (Krea lists around 39 GPT Image 2.5 images or 173 Nano Banana images on Basic). Extra packs expire after 90 days.",
				bottomLine:
					"Krea annual for the cheapest entry; Lounge for monthly billing and plain per-image prices.",
			},
			{
				heading: "Creative tools",
				us: "Image Studio focuses on generation: 1 to 4 images per prompt, model-specific resolutions up to 4K, moderation and Flex controls, and Download all bundles a batch into one zip.",
				them: "Krea goes further on tooling: real-time drawing-to-image, upscaling, LoRA training on your own subjects, 3D and Krea Nodes for custom pipelines.",
				bottomLine: "Krea for an all-in-one creative toolbox.",
			},
			{
				heading: "Everything else",
				us: "The same credits run chat with 200+ models, Video Studio, Audio Studio and Sandbox Escape, and the models are on the LLM Gateway API.",
				them: "Krea's suite stays within visual media: image, video, real-time, 3D and lip sync.",
				bottomLine: "Lounge if images are one of several AI jobs you do.",
			},
		],
		chooseThem: [
			"You want real-time generation or LoRA training on your own subjects",
			"You build visual pipelines in Krea Nodes",
			"You want Krea's own models",
			"You're fine paying yearly for 40% off",
		],
		chooseUs: [
			"You want plain per-image prices instead of compute units",
			"You compare models on one prompt",
			"You want monthly billing and top-ups that don't expire",
			"You also use chat, video and audio models",
		],
		switchHeading: "Looking for a Krea alternative?",
		whySwitch: [
			"You can't tell what an image actually costs in compute units",
			"Compute packs expired before you used them",
			"You only need generation, not the full suite",
			"You want one balance for chat and images",
		],
		migration:
			"GPT Image, Nano Banana and Grok Imagine are in Image Studio under the same names. Run your Krea prompt on them side by side; Starter at $9/mo includes every image model.",
		faq: [
			{
				q: "Is Krea cheaper per image?",
				a: "On an annual Pro plan used in full, usually yes: Nano Banana 2.1 works out to about $0.023 an image on Krea and $0.034 on Lounge pay as you go. On a Lounge Plus membership the same image costs about $0.013 of what you paid.",
			},
			{
				q: "Does Lounge have Krea's own models?",
				a: "No. Krea's models are only on Krea. Lounge runs the image models in the LLM Gateway catalogue.",
			},
			{
				q: "Does Lounge do LoRA training or real-time generation?",
				a: "No. Krea is the better fit for those.",
			},
			{
				q: "Do Lounge credits expire?",
				a: "Membership credits reset monthly. Pay-as-you-go top-ups never expire.",
			},
		],
		modelPricing: {
			heading: "Same model, cost per image",
			intro:
				"Krea prices in compute units. We divided its Pro plan ($21 a month, billed annually) by the number of images Krea says Pro buys for each model.",
			unit: "per image",
			rows: served([
				{
					model: "Nano Banana 2.1 · 1K",
					us: NANO_BANANA_2_1(),
					them: kreaPerImage(900),
				},
				{
					model: "Nano Banana Pro · 1K",
					us: NANO_BANANA_PRO(),
					them: kreaPerImage(257),
				},
				{
					model: "Grok Imagine Image 2.0 · 1K, low",
					us: GROK_IMAGINE_2(),
					them: kreaPerImage(675),
				},
				{
					model: "Qwen Image 3.0 · 1K",
					us: QWEN_IMAGE_3(),
					them: kreaPerImage(675),
				},
				{
					model: "Muse Image 1.0",
					us: MUSE_IMAGE(),
					them: kreaPerImage(2700),
				},
			]),
			sources: [{ label: "Krea pricing", url: "https://www.krea.ai/pricing" }],
			checkedOn: CHECKED_ON,
		},
	},
	{
		slug: "chatgpt-voice",
		studio: "calls",
		competitor: "ChatGPT Voice",
		competitorFull: "ChatGPT Voice (OpenAI)",
		competitorTagline: "Voice mode inside ChatGPT, metered in hours",
		category: "single-vendor",
		metaTitle: "Lounge Voice Calls vs ChatGPT Voice — pick your model",
		metaDescription:
			"ChatGPT Voice runs one OpenAI model with daily hour limits. Lounge Voice Calls let you pick OpenAI, Google or xAI realtime models and pay per token.",
		eyebrow: "One voice model vs your choice of realtime model",
		verdict:
			"ChatGPT Voice is the easiest voice assistant to start: it's part of ChatGPT, Free gets limited access, and Go and Plus get 3 hours a day of GPT-Live-1.1. Lounge Voice Calls is a phone line to the realtime model you choose, from OpenAI, Google or xAI, with its own voice list, a saved transcript for every call and token totals as you talk. Calls run on the same Realtime API you can build on, and bill per token with no daily cap.",
		usPrice: "Pay per token",
		themPrice: "Included in ChatGPT plans",
		table: [
			{
				label: "Models",
				us: `${callModels} realtime models, incl. GPT Realtime 2.1, GPT Realtime 2.1 Mini, Gemini Live and Grok Voice`,
				them: "GPT-Live-1.1 (Quip on Free and Go)",
				usWins: true,
			},
			{
				label: "Usage limits",
				us: "No daily cap; billed per token",
				them: "Free: limited. Go and Plus: 3 hours. Pro: 15 hours or unlimited, per rolling 24 hours",
			},
			{
				label: "Billing",
				us: "Pay-as-you-go credits; memberships don't cover calls",
				them: "Included in the ChatGPT plan",
			},
			{
				label: "Voices",
				us: "Each model's own voice list",
				them: "Nine voices, plus language-specific voices for Live",
			},
			{
				label: "Turn taking",
				us: "Semantic voice activity detection; interrupt any time",
				them: "Natural, free-form conversation",
			},
			{
				label: "Call history",
				us: "Saved per organization with transcript, model, voice and token totals",
				them: "Saved in the chat thread",
			},
			{
				label: "Build on it",
				us: "Same endpoint: wss://api.llmgateway.io/v1/realtime",
				them: "OpenAI Realtime API, billed separately",
				usWins: true,
			},
		],
		sections: [
			{
				heading: "Models and voices",
				us: "Voice Calls lists every model with an active realtime mapping, newest first. The voice list follows the model, and models that don't transcribe themselves let you pick a separate transcription model at the price shown next to it.",
				them: "ChatGPT Voice uses OpenAI's GPT-Live-1.1, with a lighter Quip variant on Free and Go. You choose from nine voices, plus extra voices for several languages.",
				bottomLine:
					"ChatGPT for zero setup; Lounge to hear how different realtime models handle the same conversation.",
			},
			{
				heading: "Cost",
				us: "Calls bill per token to a pay-as-you-go organization. A usage line totals responses, input and output tokens and audio tokens during the call, so you see the cost of every minute.",
				them: "Voice is included in ChatGPT plans, within a rolling 24-hour allowance: 3 hours on Go and Plus, 15 hours on the $100 Pro plan and unlimited on the $200 Pro plan. Enterprise usage-based pricing is $0.05 a minute.",
				bottomLine:
					"ChatGPT Plus if you talk daily and want a flat price; Lounge for occasional calls or model testing.",
			},
			{
				heading: "For builders",
				us: "Every Lounge call runs over the LLM Gateway Realtime API with a short-lived client secret, so what you hear is what your app gets. Calls show up in your activity feed and analytics with audio costs broken out.",
				them: "ChatGPT Voice is a consumer feature. Building your own voice app means a separate OpenAI API account and billing.",
				bottomLine:
					"Lounge if you're evaluating realtime models for a product.",
			},
		],
		chooseThem: [
			"You want voice inside the assistant you already use every day",
			"You talk for hours and want a flat monthly price",
			"You want ChatGPT's memory, tools and context in the conversation",
			"You don't want to manage credits",
		],
		chooseUs: [
			"You want to choose between OpenAI, Google and xAI realtime models",
			"You're evaluating voice models before building on the Realtime API",
			"You want every call saved with its transcript and token usage",
			"You'd rather pay per call than per month",
		],
		switchHeading: "Looking for a ChatGPT Voice alternative?",
		whySwitch: [
			"You hit the daily voice limit",
			"You want to hear Gemini or Grok on the other end",
			"You need to know what a voice minute costs before you build",
			"You want call transcripts you can reopen and rename",
		],
		migration:
			"Load pay-as-you-go credits in the dashboard, open Voice Calls, pick GPT Realtime 2.1 for the closest match to ChatGPT, choose a voice and start talking. Switch models between calls to compare.",
		faq: [
			{
				q: "Can I use a Lounge membership for voice calls?",
				a: "No. Voice calls bill to a pay-as-you-go organization with credits. Memberships cover chat, image, video and audio.",
			},
			{
				q: "Which models can I call?",
				a: "Every model with an active realtime mapping, including GPT Realtime 2.1, GPT Realtime 2.1 Mini, Gemini 3.1 Flash Live and Grok Voice.",
			},
			{
				q: "Is there a daily limit?",
				a: "No. Calls bill per token as long as the organization has credits.",
			},
		],
		modelPricing: {
			heading: "What a call costs on Lounge",
			intro:
				"Realtime models bill audio by the token. ChatGPT Voice has no per-token price: it's covered by plan hours.",
			unit: "per 1M audio tokens",
			rows: served([
				{
					model: "GPT Realtime 2.1 · audio in",
					us: perMillion("gpt-realtime-2.1", perInputAudioToken),
					them: null,
					themLabel: "Plan hours",
				},
				{
					model: "GPT Realtime 2.1 · audio out",
					us: perMillion("gpt-realtime-2.1", perOutputAudioToken),
					them: null,
					themLabel: "Plan hours",
				},
				{
					model: "GPT Realtime 2.1 Mini · audio in",
					us: perMillion("gpt-realtime-2.1-mini", perInputAudioToken),
					them: null,
					themLabel: "Plan hours",
				},
				{
					model: "GPT Realtime 2.1 Mini · audio out",
					us: perMillion("gpt-realtime-2.1-mini", perOutputAudioToken),
					them: null,
					themLabel: "Plan hours",
				},
				{
					model: "Gemini 3.1 Flash Live · audio in",
					us: perMillion("gemini-3.1-flash-live-preview", perInputAudioToken),
					them: null,
					themLabel: "Not offered",
				},
				{
					model: "Gemini 3.1 Flash Live · audio out",
					us: perMillion("gemini-3.1-flash-live-preview", perOutputAudioToken),
					them: null,
					themLabel: "Not offered",
				},
			]),
			sources: [
				{
					label: "ChatGPT Voice usage limits",
					url: "https://help.openai.com/en/articles/8400625-voice-mode-faq",
				},
			],
			checkedOn: CHECKED_ON,
		},
	},
	{
		slug: "hugging-face",
		studio: "decisions",
		competitor: "Hugging Face",
		competitorFull: "Hugging Face zero-shot classification",
		competitorTagline: "Open classifier models you call or host yourself",
		category: "developer",
		metaTitle: "Lounge Decision Studio vs Hugging Face zero-shot classifiers",
		metaDescription:
			"Zero-shot classifiers score labels. Lounge Decision Studio asks up to 10 typed questions about text or images and returns probabilities, billed on input tokens.",
		eyebrow: "Label scores vs typed answers",
		verdict:
			"Hugging Face hosts thousands of open classification models, including zero-shot classifiers that score a set of candidate labels. You try them in widgets, then run them on Inference Endpoints (CPU from $0.033/h) or your own hardware, and you can fine-tune your own. Lounge Decision Studio runs decision models from OpenAI, Microsoft and TypeSafe: up to 10 yes/no, pick-one or rating questions per input, text or images, each answered with probabilities, billed on input tokens only, and copied out as a /v1/decisions request.",
		usPrice: "From $0.042/1M tokens",
		themPrice: "From $0.033/h",
		table: [
			{
				label: "Question types",
				us: "Yes/no, pick one (2–12 options), rate (2–10 levels)",
				them: "Scores for a list of candidate labels",
				usWins: true,
			},
			{
				label: "Questions per input",
				us: "Up to 10 in one run, each with its own name",
				them: "One label set per call",
				usWins: true,
			},
			{
				label: "Images",
				us: "Up to 4 images on vision decision models",
				them: "Separate zero-shot image classification models",
			},
			{
				label: "Models",
				us: `${decisionModels} decision models: GPT-6 Luna Decisions, Microsoft-Decision-1, TypeSafe Jev`,
				them: "Thousands of open models",
			},
			{
				label: "Hosting",
				us: "Managed; nothing to deploy",
				them: "Widgets, Inference Endpoints, or self-host",
				usWins: true,
			},
			{
				label: "Pricing",
				us: "Input tokens only, from $0.042 per 1M",
				them: "Inference Endpoints by the hour, from $0.033 on CPU",
			},
			{
				label: "Fine-tuning",
				us: "Not offered",
				them: "Train and host your own classifier",
			},
			{
				label: "From test to code",
				us: "Copy any run as a /v1/decisions cURL request or raw JSON",
				them: "Inference API calls or a transformers pipeline",
			},
		],
		sections: [
			{
				heading: "What you get back",
				us: "Each question returns the value your code would branch on (true/false, an option, a level) with a probability per option. Rating answers add a weighted score, and a question the model declines comes back as Refused while the rest are answered.",
				them: "A zero-shot classifier returns a score for every candidate label you pass in. Turning several labels into several decisions, or a rating scale, is your code's job.",
				bottomLine:
					"Lounge when you need several typed answers per input; Hugging Face for a single label set.",
			},
			{
				heading: "Running it",
				us: "Paste text or drop up to 4 images, add questions or load an example, and press Decide. Compare mode runs the same input on up to three decision models, and runs are saved with their inputs and answers.",
				them: "You pick a model on the Hub, test it in the widget, then deploy it on an Inference Endpoint or your own servers, choosing the hardware yourself.",
				bottomLine:
					"Hugging Face if you need to own the model and the hardware.",
			},
			{
				heading: "Cost",
				us: "Decision models bill only the input: your text plus every question. Jev 1.14 and Microsoft-Decision-1 cost $0.042 per 1M input tokens; GPT-6 Luna Decisions $0.10 up to 272K tokens.",
				them: "Open models are free to download. Hosted endpoints bill by the hour whether or not they're busy, from $0.033 on CPU and $0.50 on an NVIDIA T4.",
				bottomLine:
					"Per-token for spiky workloads; an always-on endpoint for steady, very high volume.",
			},
		],
		chooseThem: [
			"You want to fine-tune or train your own classifier",
			"You need to run the model on your own hardware",
			"You have steady, very high volume that justifies a dedicated endpoint",
			"You need a niche open model for a specific language or domain",
		],
		chooseUs: [
			"You want several typed answers per input, not one label score",
			"You classify images and text with the same questions",
			"You want to try decisions before writing any code",
			"You'd rather pay per input token than per endpoint hour",
		],
		switchHeading: "Looking for a zero-shot classification alternative?",
		whySwitch: [
			"You're stitching several classifier calls together per input",
			"An idle endpoint costs you money overnight",
			"You need yes/no and ratings, not just labels",
			"You want to test against a frontier model's judgment",
		],
		migration:
			"Turn each candidate-label list into a pick-one question, and each yes/no rule into a yes/no question. Paste a sample into Decision Studio, press Decide, then copy the run as a /v1/decisions request.",
		faq: [
			{
				q: "What is a decision model?",
				a: "A model that answers named, typed questions (yes/no, pick one, rate) with probabilities instead of generating text. It's served through the /v1/decisions endpoint.",
			},
			{
				q: "How are decisions billed?",
				a: "On input tokens only: the input plus every question. There is no output price.",
			},
			{
				q: "Can I fine-tune a decision model?",
				a: "No. If you need a custom-trained classifier, Hugging Face is the better fit.",
			},
		],
		modelPricing: {
			heading: "Decision models, cost per 1M input tokens",
			intro:
				"Decision models bill only the input. Hugging Face endpoints bill by the hour instead, so there is no per-token figure to compare.",
			unit: "per 1M input tokens",
			rows: served([
				{
					model: "TypeSafe Jev 1.14",
					us: perMillion("jev-1.14.0", perInputToken),
					them: null,
					themLabel: "Billed per endpoint hour",
				},
				{
					model: "Microsoft-Decision-1",
					us: perMillion("microsoft-decision-1", perInputToken),
					them: null,
					themLabel: "Billed per endpoint hour",
				},
				{
					model: "GPT-6 Luna Decisions · up to 272K",
					us: perMillion("gpt-6-luna-decisions", perInputToken),
					them: null,
					themLabel: "Billed per endpoint hour",
				},
			]),
			sources: [
				{
					label: "Hugging Face pricing",
					url: "https://huggingface.co/pricing",
				},
			],
			checkedOn: CHECKED_ON,
		},
	},
	{
		slug: "kaggle-game-arena",
		studio: "escape",
		competitor: "Kaggle Game Arena",
		competitorFull: "Kaggle Game Arena (Kaggle and Google DeepMind)",
		competitorTagline: "A public leaderboard of models playing classic games",
		category: "developer",
		metaTitle: "Lounge Sandbox Escape vs Kaggle Game Arena",
		metaDescription:
			"Game Arena is a benchmark you watch. Sandbox Escape is a game you run: pick any model, watch it try to break out of a container, share the replay.",
		eyebrow: "A benchmark you watch vs a game you run",
		verdict:
			"Kaggle Game Arena, built by Kaggle and Google DeepMind, pits frontier models against each other in chess, Go, checkers and a dozen more games and publishes the leaderboard. It's a benchmark you read. Sandbox Escape is a game you run: pick any chat model in the catalogue and watch it try to break out of a sandboxed container across five fixed levels, one billed API call per move. Every run is replayed on the server before it reaches the public leaderboard, and gets its own replay link.",
		usPrice: "One API call per move",
		themPrice: "Free to browse",
		table: [
			{
				label: "What it is",
				us: "A game you run with the model you pick",
				them: "A benchmark run by Kaggle and Google DeepMind",
			},
			{
				label: "Model choice",
				us: "Pick from the catalogue's chat models",
				them: "Models the arena adds",
				usWins: true,
			},
			{
				label: "Format",
				us: "One model against the sandbox: 5 fixed levels with keys, daemons and root shells",
				them: "Head-to-head matches across 15 games",
			},
			{
				label: "Fairness",
				us: "Fixed seeds: every model gets byte-identical maps",
				them: "Same rules for every model in each game",
			},
			{
				label: "Scoring",
				us: "The server replays each run from its moves before it counts",
				them: "Platform-run matches with a score per model",
			},
			{
				label: "Cost",
				us: "One billed API call per move, capped at 200 moves",
				them: "Free to browse",
			},
			{
				label: "Share",
				us: "Replay link and preview card for every run",
				them: "Public leaderboard",
				usWins: true,
			},
		],
		sections: [
			{
				heading: "Watch vs play",
				us: "You pick the model, start the run and watch each move with the model's reasoning trace. Try the same level on two models and compare how they plan around daemons and walls.",
				them: "Game Arena runs the matches for you and publishes the standings across chess, Go, checkers, Dots and Boxes, word games and more, with match counts behind every score.",
				bottomLine:
					"Game Arena to see how frontier models rank; Sandbox Escape to test the model you care about.",
			},
			{
				heading: "Design",
				us: "Sandbox Escape is a deterministic grid: collect key shards, avoid patrolling daemons that chase for a few turns when they spot you, reach a root shell and get out within a step budget. Five levels get harder, from Hello, World to Firewall and beyond.",
				them: "Game Arena uses established games with clear win conditions and adds new games and models over time, so scores keep moving as models improve.",
				bottomLine: "Both resist memorization; they measure different skills.",
			},
			{
				heading: "Leaderboards",
				us: "The public leaderboard only accepts runs the API has replayed from scratch, so a browser can't claim a score it didn't earn. Each run has a shareable page with a replay.",
				them: "Kaggle's leaderboard covers every game together or one at a time, with the newest models added as they're released.",
				bottomLine:
					"Sandbox Escape for a run you can point to; Game Arena for broad standings.",
			},
		],
		chooseThem: [
			"You want a broad, independent ranking of frontier models",
			"You care about strategic games like chess, Go and checkers",
			"You don't want to spend anything",
			"You want results from many games in one table",
		],
		chooseUs: [
			"You want to test the exact model you're considering",
			"You want to watch the reasoning behind every move",
			"You want a replay link to share",
			"You want to try cheap and frontier models on the same five maps",
		],
		switchHeading: "Looking for something like Game Arena you can play?",
		whySwitch: [
			"The model you use isn't on the leaderboard",
			"You want to watch a run, not read a table",
			"You want to compare two models on identical levels",
			"You want to share a result",
		],
		migration:
			"Open Sandbox Escape, pick a model and start on level 1. Each move is one API call to that model, billed from your selected organization.",
		faq: [
			{
				q: "What does a run cost?",
				a: "One billed API call to the model you pick per move, at that model's normal rate. Runs are capped at 200 moves.",
			},
			{
				q: "Can a score be faked?",
				a: "No. The API replays each submitted run from its move list before it reaches the leaderboard.",
			},
			{
				q: "Is it the same for every model?",
				a: "Yes. Levels use fixed seeds, so every model plays byte-identical maps.",
			},
		],
	},
];
