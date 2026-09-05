import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/wordmark";

export type SeoVariant =
	"chat" | "image" | "video" | "audio" | "group" | "canvas" | "realtime";

interface VariantContent {
	h1: string;
	intro: string;
	bullets: string[];
	related: Array<{ href: string; label: string }>;
}

const variants: Record<SeoVariant, VariantContent> = {
	chat: {
		h1: "Lounge — AI chat with multiple models in one place",
		intro:
			"Lounge is the members' AI chat by LLM Gateway. Chat with models from multiple providers in a single interface. Switch models mid-conversation, attach files and images, and stream responses in real time — one credit balance, no per-provider billing setup.",
		bullets: [
			"Find supported models, capabilities, and pricing in the live model catalogue.",
			"Stream responses, fork past conversations, and share read-only chat snapshots via public links.",
			"One credit balance covers every provider — top up once, route requests anywhere, get unified usage and cost analytics through LLM Gateway.",
		],
		related: [
			{ href: "/image", label: "AI image generation" },
			{ href: "/video", label: "AI video generation" },
			{ href: "/audio", label: "AI audio generation" },
			{ href: "/group", label: "Compare models side by side" },
			{ href: "/canvas", label: "Canvas — UI from JSON" },
			{ href: "/compare", label: "Lounge vs ChatGPT, Claude & more" },
		],
	},
	image: {
		h1: "AI image generation — compare models in one place",
		intro:
			"Generate images from text prompts using the latest AI image models. Compare outputs across providers, request multiple variants per prompt, and save or share the results.",
		bullets: [
			"Choose an image model from the current catalogue and explore its supported settings.",
			"Request 1, 2, or 4 images per prompt and compare them in a grid.",
			"All requests route through LLM Gateway for unified billing and usage tracking.",
		],
		related: [
			{ href: "/", label: "Lounge AI chat" },
			{ href: "/video", label: "AI video generation" },
			{ href: "/audio", label: "AI audio generation" },
			{ href: "/group", label: "Compare models side by side" },
			{ href: "/canvas", label: "Canvas — UI from JSON" },
		],
	},
	video: {
		h1: "AI video generation — create and compare short videos",
		intro:
			"Generate short videos from text prompts using the newest AI video models. Preview results inline, compare providers, and download the output.",
		bullets: [
			"Choose a supported video model and review its available durations and resolutions.",
			"Preview generated videos in the browser without leaving the Lounge.",
			"Routes through LLM Gateway for cost tracking across providers.",
		],
		related: [
			{ href: "/", label: "Lounge AI chat" },
			{ href: "/image", label: "AI image generation" },
			{ href: "/audio", label: "AI audio generation" },
			{ href: "/group", label: "Compare models side by side" },
			{ href: "/canvas", label: "Canvas — UI from JSON" },
		],
	},
	audio: {
		h1: "AI audio generation — compare text-to-speech models",
		intro:
			"Turn text into natural-sounding speech using the latest text-to-speech models. Pick a voice, compare providers side by side, and download the audio.",
		bullets: [
			"Browse supported speech models and voices in the audio studio.",
			"Choose from dozens of prebuilt voices and control format and speed.",
			"All requests route through LLM Gateway for unified billing and usage tracking.",
		],
		related: [
			{ href: "/", label: "Lounge AI chat" },
			{ href: "/image", label: "AI image generation" },
			{ href: "/video", label: "AI video generation" },
			{ href: "/group", label: "Compare models side by side" },
		],
	},
	group: {
		h1: "Group chat — compare AI models side by side on the same prompt",
		intro:
			"Send one prompt to multiple AI models simultaneously and compare their responses. Evaluate response quality, speed, and cost before choosing a model for your workflow.",
		bullets: [
			"Run the same prompt against multiple supported chat models.",
			"See streamed responses side by side in real time.",
			"Compare latency, token counts, and cost per response in a single view.",
		],
		related: [
			{ href: "/", label: "Lounge AI chat" },
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
			"Choose a supported model to generate or modify canvas specs.",
			"Export the canvas to PDF or PNG for sharing.",
		],
		related: [
			{ href: "/", label: "Lounge AI chat" },
			{ href: "/image", label: "AI image generation" },
			{ href: "/video", label: "AI video generation" },
			{ href: "/audio", label: "AI audio generation" },
			{ href: "/group", label: "Compare models side by side" },
		],
	},
	realtime: {
		h1: "AI voice calls — realtime speech to speech",
		intro:
			"Have a live voice conversation with realtime speech-to-speech models. Pick a model and a voice, talk naturally, interrupt mid-sentence, and read both sides of the transcript afterwards.",
		bullets: [
			"Models include OpenAI gpt-realtime and gpt-realtime-mini plus other speech-to-speech providers.",
			"Barge in mid-sentence; the model stops and listens like a phone call.",
			"Calls route through LLM Gateway for unified billing and usage tracking.",
		],
		related: [
			{ href: "/", label: "Lounge AI chat" },
			{ href: "/audio", label: "AI audio generation" },
			{ href: "/image", label: "AI image generation" },
			{ href: "/group", label: "Compare models side by side" },
		],
	},
};

export function PlaygroundSeoSection({ variant }: { variant: SeoVariant }) {
	const content = variants[variant];
	const Container = variant === "chat" ? "section" : "main";
	return (
		<Container
			className={
				variant === "chat"
					? "sr-only"
					: "mx-auto flex max-w-4xl flex-col gap-5 px-6 py-16"
			}
		>
			{variant !== "chat" && (
				<nav
					aria-label="Lounge"
					className="mb-8 flex items-center justify-between gap-4"
				>
					<Link href="/">
						<Wordmark size="sm" />
					</Link>
					<Link
						href="/pricing"
						className="text-sm text-muted-foreground underline underline-offset-4"
					>
						Membership pricing
					</Link>
				</nav>
			)}
			<h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
				{content.h1}
			</h1>
			<p className="text-muted-foreground leading-relaxed">{content.intro}</p>
			{variant !== "chat" && (
				<div className="flex flex-wrap gap-3">
					<Button asChild>
						<Link
							href={`/signup?returnUrl=${encodeURIComponent(`/${variant}`)}`}
						>
							Get started
						</Link>
					</Button>
					<Button variant="outline" asChild>
						<Link
							href={`/login?returnUrl=${encodeURIComponent(`/${variant}`)}`}
						>
							Sign in
						</Link>
					</Button>
				</div>
			)}
			<ul className="flex list-disc flex-col gap-2 pl-5 text-muted-foreground">
				{content.bullets.map((bullet) => (
					<li key={bullet}>{bullet}</li>
				))}
			</ul>
			<p className="text-sm text-muted-foreground">
				See the{" "}
				<Link
					href="https://llmgateway.io/models"
					className="underline underline-offset-4"
				>
					live model catalogue
				</Link>{" "}
				for current availability and pricing.
			</p>
			<nav aria-label="Related tools">
				<ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm underline underline-offset-4">
					{content.related.map((link) => (
						<li key={link.href}>
							<Link href={link.href}>{link.label}</Link>
						</li>
					))}
				</ul>
			</nav>
		</Container>
	);
}
