"use client";

import { Download } from "lucide-react";

import { Card } from "@/lib/components/card";
import Logo from "@/lib/icons/Logo";

interface BrandAsset {
	name: string;
	description: string;
	svgPath: string;
	preview: "logo" | "logo-with-name";
	variant: "black" | "white";
}

const brandAssets: BrandAsset[] = [
	{
		name: "Logo (Black)",
		description: "Logo mark only, black version for light backgrounds",
		svgPath: "/brand/logo-black.svg",
		preview: "logo",
		variant: "black",
	},
	{
		name: "Logo (White)",
		description: "Logo mark only, white version for dark backgrounds",
		svgPath: "/brand/logo-white.svg",
		preview: "logo",
		variant: "white",
	},
	{
		name: "Full Logo (Black)",
		description: "Logo with LLM Gateway text, black version",
		svgPath: "/brand/logo-with-name-black.svg",
		preview: "logo-with-name",
		variant: "black",
	},
	{
		name: "Full Logo (White)",
		description: "Logo with LLM Gateway text, white version",
		svgPath: "/brand/logo-with-name-white.svg",
		preview: "logo-with-name",
		variant: "white",
	},
];

function LogoPreview({
	type,
	variant,
}: {
	type: "logo" | "logo-with-name";
	variant: "black" | "white";
}) {
	const color = variant === "black" ? "#000000" : "#ffffff";

	if (type === "logo") {
		return <Logo className="h-16 w-16" style={{ color }} />;
	}

	return (
		<div className="flex items-center gap-3">
			<Logo className="h-12 w-12" style={{ color }} />
			<span className="text-2xl font-bold tracking-tight" style={{ color }}>
				LLM Gateway
			</span>
		</div>
	);
}

function BrandAssetCard({ asset }: { asset: BrandAsset }) {
	const bgColor =
		asset.variant === "white" ? "bg-zinc-900" : "bg-zinc-100 dark:bg-zinc-100";

	const svgFilename = asset.svgPath.split("/").pop() ?? "logo.svg";

	return (
		<Card className="overflow-hidden">
			<div
				className={`${bgColor} flex items-center justify-center p-8 min-h-[160px]`}
			>
				<LogoPreview type={asset.preview} variant={asset.variant} />
			</div>
			<div className="p-6">
				<h3 className="font-semibold text-lg mb-1">{asset.name}</h3>
				<p className="text-sm text-muted-foreground mb-4">
					{asset.description}
				</p>
				<div className="flex gap-2">
					<a
						href={asset.svgPath}
						download={svgFilename}
						className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3"
					>
						<Download className="h-4 w-4" />
						SVG
					</a>
				</div>
			</div>
		</Card>
	);
}

export default function BrandPage() {
	return (
		<section className="py-20 sm:py-28">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-2xl text-center mb-16">
					<h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
						Brand Assets
					</h1>
					<p className="text-lg text-muted-foreground leading-relaxed">
						Download official LLM Gateway logos and brand assets for your
						projects, presentations, and integrations.
					</p>
				</div>

				<div className="max-w-5xl mx-auto">
					<div className="grid gap-6 sm:grid-cols-2">
						{brandAssets.map((asset) => (
							<BrandAssetCard key={asset.name} asset={asset} />
						))}
					</div>

					<div className="mt-16 p-8 rounded-xl bg-muted/50 border">
						<h2 className="text-2xl font-bold mb-4">Brand Guidelines</h2>
						<ul className="space-y-3 text-muted-foreground">
							<li className="flex items-start gap-2">
								<span className="text-primary font-bold">•</span>
								Use the black logo on light backgrounds and white logo on dark
								backgrounds
							</li>
							<li className="flex items-start gap-2">
								<span className="text-primary font-bold">•</span>
								Maintain adequate spacing around the logo (at least 20% of logo
								width)
							</li>
							<li className="flex items-start gap-2">
								<span className="text-primary font-bold">•</span>
								Do not stretch, rotate, or alter the logo proportions
							</li>
							<li className="flex items-start gap-2">
								<span className="text-primary font-bold">•</span>
								Do not add effects like shadows, gradients, or outlines to the
								logo
							</li>
							<li className="flex items-start gap-2">
								<span className="text-primary font-bold">•</span>
								For questions about brand usage, contact us at{" "}
								<a
									href="mailto:contact@llmgateway.io"
									className="text-primary hover:underline"
								>
									contact@llmgateway.io
								</a>
							</li>
						</ul>
					</div>
				</div>
			</div>
		</section>
	);
}
