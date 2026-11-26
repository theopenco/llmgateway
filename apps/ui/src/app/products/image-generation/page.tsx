import {
	Brush,
	CircleDollarSign,
	Layers,
	Receipt,
	Route,
	ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { CompareFaq } from "@/components/compare/compare-faq";
import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import {
	ProductClosingCta,
	ProductCodeBlock,
	ProductFeatureGrid,
	ProductHero,
	productJsonLd,
} from "@/components/products/product-sections";
import { DataAsOf } from "@/components/seo/data-as-of";
import { JsonLd } from "@/components/seo/json-ld";
import { fetchModels } from "@/lib/fetch-models";
import { buildImageModelRows, formatImagePrice } from "@/lib/image-pricing";

import type { Metadata } from "next";

export const revalidate = 3600;

const title = "Image Generation API — One Endpoint, Every Image Model";
const description =
	"Generate and edit images through one OpenAI-compatible API: every image model in the catalogue, per-image pricing at provider rates, automatic failover, and cost tracking per request.";

export const metadata: Metadata = {
	title,
	description,
	alternates: { canonical: "/products/image-generation" },
	openGraph: {
		title,
		description,
		url: "https://llmgateway.io/products/image-generation",
		type: "website",
	},
};

const features = [
	{
		icon: Layers,
		title: "One API for every image model",
		description:
			"Call any image model in the catalogue with the same request. Switching models is a one-word change, not a new SDK.",
	},
	{
		icon: Brush,
		title: "Generate and edit",
		description:
			"OpenAI-compatible /v1/images/generations and /v1/images/edits, plus image output in /v1/chat/completions for conversational edits.",
	},
	{
		icon: Route,
		title: "Failover across providers",
		description:
			"When several providers serve a model, a request that names only the model is retried on another one if the first fails.",
	},
	{
		icon: CircleDollarSign,
		title: "Provider prices, per image",
		description:
			"Each image is billed at the provider's rate for its size and quality. The table below is read from the live catalogue.",
	},
	{
		icon: Receipt,
		title: "Cost on every response",
		description:
			"Image responses carry a usage object with the billed cost, and the dashboard breaks spend down by model, provider and API key.",
	},
	{
		icon: ShieldCheck,
		title: "Keys and limits per project",
		description:
			"Give each app or customer its own API key with a spending limit, and bring your own provider keys when you have them.",
	},
];

const curlExample = `curl -X POST "https://api.llmgateway.io/v1/images/generations" \\
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "<image-model-id>",
    "prompt": "A lighthouse on a cliff at dawn, watercolor",
    "size": "1024x1024"
  }'`;

export default async function ImageGenerationProductPage() {
	const rows = buildImageModelRows(await fetchModels());
	const priced = rows.filter((row) => row.fromPrice !== null);
	const cheapest = priced[0];

	const faqs = [
		{
			question: "How much does it cost to generate an image?",
			answer: cheapest
				? `It depends on the model, size and quality. Prices start at ${formatImagePrice(cheapest.fromPrice ?? 0)} per image, and each model page lists every size and quality tier. Pay-as-you-go credits carry a flat 5% platform fee; requests on your own provider keys carry none.`
				: "It depends on the model, size and quality. Each model page lists every size and quality tier. Pay-as-you-go credits carry a flat 5% platform fee; requests on your own provider keys carry none.",
		},
		{
			question: "Which API do I call?",
			answer:
				"POST https://api.llmgateway.io/v1/images/generations with a model and a prompt. It accepts the same request as OpenAI's images API, so the OpenAI SDK and the Vercel AI SDK work after changing the base URL and API key. Use /v1/images/edits to edit existing images.",
		},
		{
			question: "Can I edit images or keep a conversation going?",
			answer:
				"Yes. /v1/images/edits takes input images and a prompt. Image models also work in /v1/chat/completions, where you can send images, ask for changes and get new images back in the same conversation.",
		},
		{
			question: "What happens when an image provider is down?",
			answer:
				"If more than one provider serves the model and the request names only the model, the gateway retries on another provider. Requests pinned to one provider can be kept there with the X-No-Fallback header.",
		},
		{
			question: "Can I try a model before writing code?",
			answer:
				"Yes. The Lounge image studio runs the same models in the browser, with the size and quality options each one supports.",
		},
	];

	const itemListSchema = {
		"@context": "https://schema.org",
		"@type": "ItemList",
		name: "Image generation models on LLM Gateway",
		numberOfItems: rows.length,
		itemListElement: rows.map((row, index) => ({
			"@type": "ListItem",
			position: index + 1,
			name: row.name,
			url: `https://llmgateway.io/models/${encodeURIComponent(row.id)}`,
		})),
	};

	return (
		<>
			<JsonLd
				data={[
					...productJsonLd({
						slug: "image-generation",
						name: "Image Generation API",
						description,
					}),
					...(rows.length > 0 ? [itemListSchema] : []),
				]}
			/>
			<Navbar />
			<main className="min-h-screen bg-background">
				<ProductHero
					accent="amber"
					eyebrow="Product · Image generation"
					title="One API for every image model."
					subtitle="Generate and edit images at provider prices."
					description="LLM Gateway puts the image models of every major lab behind one OpenAI-compatible endpoint. Pick a model per request, pay per image, and see what each one cost."
					ctas={[
						{ label: "Get an API key", href: "/signup" },
						{
							label: "Read the docs",
							href: "https://docs.llmgateway.io/features/image-generation",
							external: true,
							variant: "outline",
						},
					]}
					stats={[
						{ value: String(rows.length), label: "Image models" },
						...(cheapest
							? [
									{
										value: formatImagePrice(cheapest.fromPrice ?? 0),
										label: "Per image, from",
									},
								]
							: []),
						{ value: "3", label: "Endpoints" },
					]}
				/>

				<div className="mx-auto max-w-6xl space-y-24 px-6 py-20 md:space-y-36 md:py-28">
					<section className="space-y-8">
						<div className="mx-auto max-w-2xl text-center">
							<h2 className="text-3xl font-bold tracking-tight md:text-4xl">
								An image in one request
							</h2>
							<p className="mt-4 text-muted-foreground md:text-lg">
								The same request as OpenAI&apos;s images API. Change the base
								URL and the key, then pick any model from the table below.
							</p>
						</div>
						<ProductCodeBlock code={curlExample} filename="generate.sh" />
					</section>

					<section
						aria-labelledby="image-pricing-heading"
						className="space-y-6"
					>
						<div className="max-w-2xl">
							<h2
								id="image-pricing-heading"
								className="text-3xl font-bold tracking-tight md:text-4xl"
							>
								Image generation pricing
							</h2>
							<p className="mt-4 text-muted-foreground md:text-lg">
								The lowest price of one image for each model, across the
								providers that serve it today. Larger sizes and higher quality
								cost more; each model page has the full list.
							</p>
							<DataAsOf className="mt-3" />
						</div>
						{rows.length > 0 ? (
							<div className="overflow-x-auto rounded-2xl border">
								<table className="w-full min-w-[520px] text-left text-sm">
									<thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
										<tr>
											<th scope="col" className="px-4 py-3 font-medium">
												Model
											</th>
											<th scope="col" className="px-4 py-3 font-medium">
												Made by
											</th>
											<th
												scope="col"
												className="px-4 py-3 text-right font-medium"
											>
												Providers
											</th>
											<th
												scope="col"
												className="px-4 py-3 text-right font-medium"
											>
												Per image, from
											</th>
										</tr>
									</thead>
									<tbody className="divide-y">
										{rows.map((row) => (
											<tr key={row.id}>
												<th scope="row" className="px-4 py-3 font-medium">
													<Link
														href={`/models/${encodeURIComponent(row.id)}`}
														className="underline-offset-4 hover:underline"
													>
														{row.name}
													</Link>
												</th>
												<td className="px-4 py-3 text-muted-foreground">
													{row.family}
												</td>
												<td className="px-4 py-3 text-right tabular-nums">
													{row.providerCount}
												</td>
												<td className="px-4 py-3 text-right tabular-nums">
													{row.fromPrice !== null
														? formatImagePrice(row.fromPrice)
														: "Priced per token"}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						) : (
							<p className="text-muted-foreground">
								The model list is unavailable right now. Browse{" "}
								<Link href="/models/text-to-image" className="underline">
									all image models
								</Link>
								.
							</p>
						)}
						<p className="text-sm text-muted-foreground">
							Compare every option on the{" "}
							<Link href="/models/text-to-image" className="underline">
								text-to-image
							</Link>{" "}
							and{" "}
							<Link href="/models/image-to-image" className="underline">
								image-to-image
							</Link>{" "}
							pages.
						</p>
					</section>

					<ProductFeatureGrid
						title="Built for apps that make a lot of images"
						features={features}
					/>
				</div>

				<CompareFaq heading="Image generation, answered" faqs={faqs} />

				<ProductClosingCta
					accent="amber"
					title="Ship image generation today"
					description="Create a key, send one request, and switch models whenever a better one ships."
					ctas={[
						{ label: "Get started", href: "/signup" },
						{
							label: "Browse image models",
							href: "/models/text-to-image",
							variant: "outline",
						},
					]}
				/>
			</main>
			<Footer />
		</>
	);
}
