import { ArrowDown, ArrowUpRight, Check, Download, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { LogoLockup } from "@/lib/icons/Logo";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Brand Assets — Logos & Guidelines",
	description:
		"Download official LLM Gateway logos in SVG and transparent PNG. Explore logo usage, spacing, colors, typography, and brand guidelines.",
	openGraph: {
		title: "Brand Assets — Logos & Guidelines | LLM Gateway",
		description:
			"Official SVG and PNG logos, colors, and guidelines for using the LLM Gateway brand.",
		type: "website",
		url: "https://llmgateway.io/brand",
	},
};

const assets = [
	{
		name: "Full logo · black",
		file: "logo-with-name-black",
		white: false,
		full: true,
	},
	{
		name: "Full logo · white",
		file: "logo-with-name-white",
		white: true,
		full: true,
	},
	{ name: "Symbol · black", file: "logo-black", white: false, full: false },
	{ name: "Symbol · white", file: "logo-white", white: true, full: false },
];

const colors = [
	{
		name: "Black",
		hex: "#000000",
		rgb: "0, 0, 0",
		usage: "Primary logo on light backgrounds.",
		text: "text-white",
	},
	{
		name: "White",
		hex: "#FFFFFF",
		rgb: "255, 255, 255",
		usage: "Reversed logo on dark backgrounds.",
		text: "text-black",
	},
	{
		name: "Ink",
		hex: "#18181B",
		rgb: "24, 24, 27",
		usage: "Dark surfaces. Pair with the white logo.",
		text: "text-white",
	},
	{
		name: "Mist",
		hex: "#F4F4F5",
		rgb: "244, 244, 245",
		usage: "Light surfaces. Pair with the black logo.",
		text: "text-black",
	},
];

function SectionHeading({
	number,
	title,
	children,
}: {
	number: string;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="mb-8 grid gap-3 md:grid-cols-[1fr_1fr] md:gap-12">
			<h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
				<span className="mr-4 align-middle font-mono text-xs font-normal text-muted-foreground">
					{number}
				</span>
				{title}
			</h2>
			<p className="max-w-xl text-sm leading-6 text-muted-foreground">
				{children}
			</p>
		</div>
	);
}

export default function BrandPage() {
	return (
		<main className="mx-auto max-w-6xl px-6 pt-40 pb-24 sm:px-8 sm:pt-48">
			<header className="mb-14 grid gap-8 md:grid-cols-[1.2fr_1fr] md:items-end">
				<div>
					<p className="mb-5 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
						LLM Gateway / Brand resources
					</p>
					<h1 className="font-display text-5xl font-semibold leading-[1.05] tracking-tight sm:text-7xl">
						One identity.
						<br />
						<span className="text-muted-foreground">Every connection.</span>
					</h1>
				</div>
				<div className="max-w-sm md:justify-self-end">
					<p className="text-base leading-7 text-muted-foreground">
						The official assets and guidelines for representing LLM Gateway.
						Built for your next integration, presentation, or story.
					</p>
					<Link
						href="#downloads"
						className="mt-6 inline-flex min-h-11 items-center gap-3 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
					>
						Get the assets <ArrowDown className="size-4" aria-hidden="true" />
					</Link>
				</div>
			</header>

			<div className="relative mb-16 flex min-h-56 items-center justify-center overflow-hidden rounded-2xl border bg-[#F4F4F5] px-8 py-20 text-black sm:min-h-80 sm:px-20 dark:bg-[#18181B] dark:text-white">
				<span className="absolute top-5 left-6 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
					The primary signature
				</span>
				<LogoLockup className="relative w-full max-w-2xl" />
				<div className="absolute right-6 bottom-5 left-6 flex justify-between font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
					<span>Symbol + wordmark</span>
					<span>Always on the same line</span>
				</div>
			</div>

			<nav
				aria-label="Brand guidelines"
				className="mb-16 flex flex-wrap gap-x-7 gap-y-3 border-y py-5 text-sm text-muted-foreground"
			>
				{[
					["downloads", "01 / Downloads"],
					["logo-usage", "02 / Logo usage"],
					["colors", "03 / Colors"],
					["typography", "04 / Typography"],
					["in-practice", "05 / In practice"],
				].map(([id, label]) => (
					<Link
						key={id}
						href={`#${id}`}
						className="rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
					>
						{label}
					</Link>
				))}
			</nav>

			<section id="downloads" className="scroll-mt-36 border-b pb-16">
				<SectionHeading number="01" title="Ready to use">
					Use the full logo whenever space allows. The symbol works for avatars,
					app icons, and places where the name is already visible.
				</SectionHeading>
				<div className="grid gap-5 sm:grid-cols-2">
					{assets.map((asset) => (
						<article
							key={asset.file}
							className="overflow-hidden rounded-xl border"
						>
							<div
								className={`flex h-48 items-center justify-center px-8 ${asset.white ? "bg-[#18181B]" : "bg-[#F4F4F5]"}`}
							>
								<Image
									src={`/brand/${asset.file}.svg`}
									alt={asset.name}
									width={asset.full ? 1522 : 218}
									height={232}
									unoptimized
									className={
										asset.full ? "h-auto w-full max-w-80" : "h-20 w-auto"
									}
								/>
							</div>
							<div className="flex flex-wrap items-center justify-between gap-4 p-5">
								<div>
									<h3 className="text-sm font-semibold">{asset.name}</h3>
									<p className="mt-1 text-xs text-muted-foreground">
										{asset.full ? "2047 × 312" : "962 × 1024"} px PNG ·
										transparent
									</p>
								</div>
								<div className="flex gap-2">
									{["svg", "png"].map((format) => (
										<a
											key={format}
											href={`/brand/${asset.file}.${format}`}
											download={`llm-gateway-${asset.file}.${format}`}
											aria-label={`Download ${asset.name} as ${format.toUpperCase()}`}
											className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
										>
											<Download className="size-3.5" aria-hidden="true" />
											{format.toUpperCase()}
										</a>
									))}
								</div>
							</div>
						</article>
					))}
				</div>
				<p className="mt-5 text-sm leading-6 text-muted-foreground">
					SVG scales to any size and keeps lettering intact. Choose PNG for
					slides, social posts, and tools that need a raster image. All files
					have transparent backgrounds; the preview backgrounds are not
					included.
				</p>
			</section>

			<section id="logo-usage" className="scroll-mt-36 border-b py-16">
				<SectionHeading number="02" title="Give it room">
					Keep the symbol to the left of the name, vertically centered. Use the
					supplied artwork as one unit to preserve its spacing and proportions.
				</SectionHeading>
				<div className="grid gap-8 md:grid-cols-2">
					<div className="flex min-h-56 flex-col items-center justify-center rounded-xl border bg-muted/30 p-8">
						<div className="w-full max-w-sm border border-dashed border-muted-foreground/50 p-6">
							<LogoLockup className="w-full text-black dark:text-white" />
						</div>
						<p className="mt-5 font-mono text-xs text-muted-foreground">
							Clear space ≥ ½ symbol height on every side
						</p>
					</div>
					<div className="space-y-6 py-2">
						<div>
							<h3 className="mb-2 text-sm font-semibold">Clear space</h3>
							<p className="text-sm leading-6 text-muted-foreground">
								Leave at least half the symbol’s height around the entire logo.
								Keep text, other logos, and edges outside this area. More room
								is always welcome.
							</p>
						</div>
						<div>
							<h3 className="mb-2 text-sm font-semibold">Minimum size</h3>
							<p className="text-sm leading-6 text-muted-foreground">
								Keep the full logo at least 144 px wide on screen or 30 mm in
								print. Keep the standalone symbol at least 24 px high or 6 mm in
								print. Use the supplied favicon assets for browser tabs.
							</p>
						</div>
						<div>
							<h3 className="mb-2 text-sm font-semibold">Placement</h3>
							<p className="text-sm leading-6 text-muted-foreground">
								Use the horizontal logo in headers and partner rows. Keep it
								visually balanced with adjacent brands, with clear space between
								them.
							</p>
						</div>
					</div>
				</div>
			</section>

			<section id="colors" className="scroll-mt-36 border-b py-16">
				<SectionHeading number="03" title="A neutral foundation">
					The logo is always pure black or white. Ink and Mist are supporting
					background colors, giving the identity a clear, quiet frame.
				</SectionHeading>
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{colors.map((color) => (
						<article
							key={color.name}
							className="overflow-hidden rounded-xl border"
						>
							<div
								style={{ backgroundColor: color.hex }}
								className={`flex h-36 flex-col justify-between p-5 ${color.text}`}
							>
								<h3 className="text-sm font-medium">{color.name}</h3>
								<span className="font-mono text-lg">{color.hex}</span>
							</div>
							<div className="p-5">
								<p className="mb-3 font-mono text-xs text-muted-foreground">
									RGB {color.rgb}
								</p>
								<p className="text-sm leading-6 text-muted-foreground">
									{color.usage}
								</p>
							</div>
						</article>
					))}
				</div>
				<p className="mt-5 text-sm leading-6 text-muted-foreground">
					Choose the version with the strongest contrast. On photographs or
					colorful layouts, place the logo on a solid neutral panel. Keep color
					in the surrounding design; do not recolor the mark.
				</p>
			</section>

			<section id="typography" className="scroll-mt-36 border-b py-16">
				<SectionHeading number="04" title="Type with purpose">
					Use a clear hierarchy, generous spacing, and concise language. The
					logo’s outlined lettering is fixed; use these typefaces for the
					content around it.
				</SectionHeading>
				<div className="grid gap-8 sm:grid-cols-3">
					<div>
						<p className="mb-5 font-mono text-xs text-muted-foreground">
							01 / Headlines
						</p>
						<p className="font-display text-4xl font-semibold tracking-tight">
							Connect.
						</p>
						<h3 className="mt-5 text-sm font-semibold">Plus Jakarta Sans</h3>
						<p className="mt-2 text-sm leading-6 text-muted-foreground">
							Semibold and bold for editorial headings. Keep line lengths short.
						</p>
					</div>
					<div>
						<p className="mb-5 font-mono text-xs text-muted-foreground">
							02 / Body & interface
						</p>
						<p className="text-4xl font-medium tracking-tight">
							Build clearly.
						</p>
						<h3 className="mt-5 text-sm font-semibold">Inter</h3>
						<p className="mt-2 text-sm leading-6 text-muted-foreground">
							Regular and medium for body copy and controls. Use a system
							sans-serif when unavailable.
						</p>
					</div>
					<div>
						<p className="mb-5 font-mono text-xs text-muted-foreground">
							03 / Technical details
						</p>
						<p className="font-mono text-4xl tracking-tight">200 OK</p>
						<h3 className="mt-5 text-sm font-semibold">Geist Mono</h3>
						<p className="mt-2 text-sm leading-6 text-muted-foreground">
							Code, values, and small labels. Fall back to the system monospace
							font.
						</p>
					</div>
				</div>
			</section>

			<section id="in-practice" className="scroll-mt-36 py-16">
				<SectionHeading number="05" title="Keep it recognizable">
					Consistency matters more than decoration. Use the original files and
					make the relationship to LLM Gateway clear.
				</SectionHeading>
				<div className="grid gap-8 sm:grid-cols-2">
					<div className="space-y-5">
						{[
							"Use black on light surfaces and white on dark surfaces.",
							"Keep the symbol and name together on one line.",
							"Write “LLM Gateway” with this capitalization and spacing.",
							"Describe what your integration does in direct, factual language.",
						].map((rule) => (
							<p key={rule} className="flex gap-3 text-sm leading-6">
								<Check
									className="mt-1 size-4 shrink-0 text-muted-foreground"
									aria-hidden="true"
								/>
								{rule}
							</p>
						))}
					</div>
					<div className="space-y-5">
						{[
							"Do not stretch, rotate, crop, or rearrange the logo.",
							"Do not add gradients, shadows, outlines, or new colors.",
							"Do not retype the wordmark or separate it across lines.",
							"Do not imply sponsorship or endorsement without permission.",
						].map((rule) => (
							<p
								key={rule}
								className="flex gap-3 text-sm leading-6 text-muted-foreground"
							>
								<X className="mt-1 size-4 shrink-0" aria-hidden="true" />
								{rule}
							</p>
						))}
					</div>
				</div>
			</section>

			<div className="flex flex-wrap items-center justify-between gap-6 rounded-xl border bg-muted/30 p-8">
				<div>
					<h2 className="font-display text-xl font-semibold">
						Making something with our brand?
					</h2>
					<p className="mt-2 text-sm text-muted-foreground">
						For custom uses or questions about these guidelines, get in touch.
					</p>
				</div>
				<Link
					href="/contact"
					className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-md border bg-background px-4 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
				>
					Contact us <ArrowUpRight className="size-4" aria-hidden="true" />
				</Link>
			</div>
		</main>
	);
}
