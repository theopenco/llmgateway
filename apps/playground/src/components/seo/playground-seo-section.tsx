import Link from "next/link";

export type SeoVariant =
	| "chat"
	| "image"
	| "video"
	| "audio"
	| "group"
	| "canvas";

interface VariantContent {
	h1: string;
	intro: string;
	bullets: string[];
	related: Array<{ href: string; label: string }>;
}

const variants: Record<SeoVariant, VariantContent> = {
	chat: {
		h1: "AI chat playground — talk to 200+ models in one place",
		intro:
			"Chat with GPT, Claude, Gemini, Grok, DeepSeek, Llama, Mistral, and more from a single interface. Switch models mid-conversation, attach files and images, and stream responses in real time. Pay-as-you-go from a single credit balance — no per-provider billing setup.",
		bullets: [
			"Supports 200+ models across OpenAI, Anthropic, Google, xAI, DeepSeek, Meta, Mistral, and other providers.",
			"Stream responses, fork past conversations, and share read-only chat snapshots via public links.",
			"One credit balance covers every provider — top up once, route requests anywhere, get unified usage and cost analytics through LLM Gateway.",
		],
		related: [
			{ href: "/image", label: "AI image generation" },
			{ href: "/video", label: "AI video generation" },
			{ href: "/audio", label: "AI audio generation" },
			{ href: "/group", label: "Compare models side by side" },
			{ href: "/canvas", label: "Canvas — UI from JSON" },
			{ href: "/compare", label: "LLM Gateway Chat vs ChatGPT, Claude & more" },
		],
	},
	image: {
		h1: "AI image generation — DALL·E, Flux, Stable Diffusion side by side",
		intro:
			"Generate images from text prompts using the latest AI image models. Compare outputs across providers, request multiple variants per prompt, and save or share the results.",
		bullets: [
			"Models include DALL·E 3, Flux Pro, Flux Schnell, Stable Diffusion 3, Seedream, and more.",
			"Request 1, 2, or 4 images per prompt and compare them in a grid.",
			"All requests route through LLM Gateway for unified billing and usage tracking.",
		],
		related: [
			{ href: "/", label: "AI chat playground" },
			{ href: "/video", label: "AI video generation" },
			{ href: "/audio", label: "AI audio generation" },
			{ href: "/group", label: "Compare models side by side" },
			{ href: "/canvas", label: "Canvas — UI from JSON" },
		],
	},
	video: {
		h1: "AI video generation — compare Veo, Wan, and more in one playground",
		intro:
			"Generate short videos from text prompts using the newest AI video models. Preview results inline, compare providers, and download the output.",
		bullets: [
			"Models include Google Veo, Alibaba Wan, and other text-to-video providers.",
			"Preview generated videos in the browser without leaving the playground.",
			"Routes through LLM Gateway for cost tracking across providers.",
		],
		related: [
			{ href: "/", label: "AI chat playground" },
			{ href: "/image", label: "AI image generation" },
			{ href: "/audio", label: "AI audio generation" },
			{ href: "/group", label: "Compare models side by side" },
			{ href: "/canvas", label: "Canvas — UI from JSON" },
		],
	},
	audio: {
		h1: "AI audio generation — text to speech with ElevenLabs, OpenAI, and Gemini",
		intro:
			"Turn text into natural-sounding speech using the latest text-to-speech models. Pick a voice, compare providers side by side, and download the audio.",
		bullets: [
			"Models include ElevenLabs Multilingual v2, Eleven v3, OpenAI TTS and GPT-4o Mini TTS, and Gemini TTS.",
			"Choose from dozens of prebuilt voices and control format and speed.",
			"All requests route through LLM Gateway for unified billing and usage tracking.",
		],
		related: [
			{ href: "/", label: "AI chat playground" },
			{ href: "/image", label: "AI image generation" },
			{ href: "/video", label: "AI video generation" },
			{ href: "/group", label: "Compare models side by side" },
		],
	},
	group: {
		h1: "Group chat — compare AI models side by side on the same prompt",
		intro:
			"Send one prompt to multiple AI models simultaneously and compare their responses. Useful for evaluating quality, speed, and cost across GPT, Claude, Gemini, Grok, and other models.",
		bullets: [
			"Run the same prompt against any combination of 200+ supported models.",
			"See streamed responses side by side in real time.",
			"Compare latency, token counts, and cost per response in a single view.",
		],
		related: [
			{ href: "/", label: "AI chat playground" },
			{ href: "/image", label: "AI image generation" },
			{ href: "/video", label: "AI video generation" },
			{ href: "/audio", label: "AI audio generation" },
			{ href: "/canvas", label: "Canvas — UI from JSON" },
		],
	},
	canvas: {
		h1: "Canvas — build UIs from JSON specs with live preview",
		intro:
			"Generate, edit, and export interactive UI specs as JSON with live preview. Export the result as a PDF or image. Powered by LLM Gateway.",
		bullets: [
			"Iterate on UI layouts by editing a JSON spec with live preview.",
			"Use any of 200+ supported models to generate or modify canvas specs.",
			"Export the canvas to PDF or PNG for sharing.",
		],
		related: [
			{ href: "/", label: "AI chat playground" },
			{ href: "/image", label: "AI image generation" },
			{ href: "/video", label: "AI video generation" },
			{ href: "/audio", label: "AI audio generation" },
			{ href: "/group", label: "Compare models side by side" },
		],
	},
};

export function PlaygroundSeoSection({ variant }: { variant: SeoVariant }) {
	const content = variants[variant];
	return (
		<section className="sr-only">
			<h1>{content.h1}</h1>
			<p>{content.intro}</p>
			<ul>
				{content.bullets.map((bullet) => (
					<li key={bullet}>{bullet}</li>
				))}
			</ul>
			<nav aria-label="Related tools">
				<ul>
					{content.related.map((link) => (
						<li key={link.href}>
							<Link href={link.href}>{link.label}</Link>
						</li>
					))}
				</ul>
			</nav>
		</section>
	);
}
