import {
	AudioLines,
	Film,
	Folder,
	ImagePlus,
	MessageSquare,
	PenTool,
	ScrollText,
	Users,
} from "lucide-react";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import {
	ProductClosingCta,
	ProductFeatureGrid,
	ProductHero,
	ProductScreenshot,
	productJsonLd,
} from "@/components/products/product-sections";
import { getConfig } from "@/lib/config-server";

import type { Metadata } from "next";

const title = "Lounge — Every Frontier Model, One Membership";
const description =
	"Lounge is the members' lounge for AI: chat with GPT, Claude, and Gemini, generate images, video, and audio, and run multi-model group chats — one membership from $9/mo.";

export const metadata: Metadata = {
	title,
	description,
	alternates: { canonical: "/products/lounge" },
	openGraph: {
		title,
		description,
		url: "https://llmgateway.io/products/lounge",
		type: "website",
	},
};

const studios = [
	{
		icon: MessageSquare,
		title: "Chat",
		description:
			"Talk to GPT, Claude, Gemini, Grok, and 200+ more models in one conversation view. Fork conversations and share read-only snapshots via public links.",
	},
	{
		icon: Users,
		title: "Group Chat",
		description:
			"Send the same prompt to any combination of models and watch responses stream side by side — compare latency, token counts, and cost per response.",
	},
	{
		icon: ImagePlus,
		title: "Image Studio",
		description:
			"Generate images with DALL·E, Flux, Stable Diffusion, Seedream, and more. Create 1, 2, or 4 images per prompt and compare outputs in a grid.",
	},
	{
		icon: Film,
		title: "Video Studio",
		description:
			"Create AI-generated videos with Sora, Veo, Kling, and more. Set resolution, duration, and audio options, then preview results inline.",
	},
	{
		icon: AudioLines,
		title: "Audio Studio",
		description:
			"Generate speech with ElevenLabs, OpenAI TTS, and Gemini TTS. Pick from dozens of voices, control format and speed, and download the result.",
	},
	{
		icon: PenTool,
		title: "Canvas",
		description:
			"Build UIs from JSON specs with a live preview, then export the result to PDF or PNG.",
	},
	{
		icon: Folder,
		title: "Projects",
		description:
			"Organize chats and generated media into projects so long-running work stays grouped and easy to find.",
	},
	{
		icon: ScrollText,
		title: "Skills",
		description:
			"Reusable instruction sets that shape how models respond — apply them to any conversation.",
	},
];

export default function LoungeProductPage() {
	const config = getConfig();
	const jsonLd = productJsonLd({
		slug: "lounge",
		name: "Lounge",
		description,
	});

	return (
		<>
			{jsonLd.map((schema, i) => (
				<script
					key={i}
					type="application/ld+json"
					// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
					dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
				/>
			))}
			<Navbar />
			<main className="min-h-screen bg-background">
				<ProductHero
					accent="amber"
					eyebrow="Product · Lounge"
					title="Every frontier model. One membership."
					subtitle="The members' lounge for AI."
					description="Chat with GPT, Claude, and Gemini, generate images and video, and run multi-model group chats. Lounge replaces ChatGPT Plus, Claude Pro, and Gemini Advanced with one membership — starting at $9/mo."
					ctas={[
						{
							label: "Open Lounge",
							href: config.playgroundUrl,
							external: true,
						},
						{
							label: "See membership pricing",
							href: `${config.playgroundUrl}/pricing`,
							external: true,
							variant: "outline",
						},
					]}
					stats={[
						{ value: "200+", label: "Models" },
						{ value: "6", label: "Studios" },
						{ value: "$9/mo", label: "Starting price" },
					]}
				/>

				<div className="mx-auto max-w-6xl space-y-24 px-6 py-20 md:space-y-36 md:py-28">
					<section className="space-y-24 md:space-y-32">
						<ProductScreenshot
							slug="playground"
							alt="Lounge chat with multiple frontier AI models"
							title="One chat for every model"
							description="Claude Opus, GPT-5, Gemini Pro, and Grok in a single conversation view — with real-time usage and per-message cost."
						/>
						<ProductScreenshot
							slug="image-studio"
							alt="Lounge Image Studio generating images with multiple AI models"
							title="Image Studio"
							description="Generate and edit images with multiple providers and compare outputs side by side with adjustable settings."
						/>
						<ProductScreenshot
							slug="video-studio"
							alt="Lounge Video Studio generating AI videos"
							title="Video Studio"
							description="Create AI-generated videos with Sora, Veo, Kling, and more — resolution, duration, and audio options in one interface."
						/>
						<ProductScreenshot
							slug="audio-studio"
							alt="Lounge Audio Studio generating speech from text"
							title="Audio Studio"
							description="Text to speech with ElevenLabs, OpenAI, and Gemini voices — pick a voice, generate, and download."
						/>
					</section>

					<ProductFeatureGrid
						title="Everything in the Lounge"
						features={studios}
						columns={4}
					/>
				</div>

				<ProductClosingCta
					accent="amber"
					title="Take a seat in the Lounge"
					description="Memberships start at $9/mo with a self-serve money-back guarantee — refund a barely-used membership from your billing history. Your allowance refills every cycle, metered at provider rates."
					ctas={[
						{
							label: "Open Lounge",
							href: config.playgroundUrl,
							external: true,
						},
					]}
				/>
			</main>
			<Footer />
		</>
	);
}
