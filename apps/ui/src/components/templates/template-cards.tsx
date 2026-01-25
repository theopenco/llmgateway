"use client";

import {
	ArrowUpRight,
	Code2,
	Copy,
	Check,
	Image as ImageIcon,
	Sparkles,
	Github,
} from "lucide-react";
import { useState, useCallback } from "react";

import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { Card } from "@/lib/components/card";

interface Template {
	name: string;
	description: string;
	href: string;
	icon: typeof ImageIcon;
	tags: string[];
	gradient: string;
	featured?: boolean;
}

const templates: Template[] = [
	{
		name: "Image Generation",
		description:
			"Generate stunning images with AI using multiple providers. Supports DALL-E, Stable Diffusion, and more through a unified API.",
		href: "https://github.com/theopenco/llmgateway-templates/tree/main/templates/image-generation",
		icon: ImageIcon,
		tags: ["TypeScript", "Next.js", "AI SDK"],
		gradient: "from-violet-500/20 via-fuchsia-500/20 to-pink-500/20",
		featured: true,
	},
];

export function TemplateCards() {
	const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

	const copyToClipboard = useCallback((url: string) => {
		navigator.clipboard.writeText(`git clone ${url}`);
		setCopiedUrl(url);
		setTimeout(() => setCopiedUrl(null), 2000);
	}, []);

	if (templates.length === 0) {
		return (
			<div className="text-center py-16">
				<Sparkles className="mx-auto h-12 w-12 text-muted-foreground/50" />
				<p className="mt-4 text-muted-foreground">
					Templates coming soon. Check back later!
				</p>
			</div>
		);
	}

	return (
		<div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-2 max-w-5xl mx-auto">
			{templates.map((template) => (
				<Card
					key={template.name}
					className="group relative overflow-hidden border-0 bg-gradient-to-br from-background to-muted/30 shadow-xl hover:shadow-2xl transition-all duration-500"
				>
					{/* Gradient overlay */}
					<div
						className={`absolute inset-0 bg-gradient-to-br ${template.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`}
					/>

					{/* Featured badge */}
					{template.featured && (
						<div className="absolute top-4 right-4 z-10">
							<Badge className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white border-0 shadow-lg">
								<Sparkles className="mr-1 h-3 w-3" />
								Featured
							</Badge>
						</div>
					)}

					<div className="relative p-6 space-y-6">
						{/* Icon with animated background */}
						<div className="relative">
							<div className="absolute inset-0 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-2xl blur-xl opacity-20 group-hover:opacity-40 transition-opacity duration-500" />
							<div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg">
								<template.icon className="h-8 w-8 text-white" />
							</div>
						</div>

						{/* Content */}
						<div className="space-y-3">
							<h3 className="text-2xl font-bold tracking-tight">
								{template.name}
							</h3>
							<p className="text-muted-foreground leading-relaxed">
								{template.description}
							</p>
						</div>

						{/* Tags */}
						<div className="flex flex-wrap gap-2">
							{template.tags.map((tag) => (
								<Badge
									key={tag}
									variant="secondary"
									className="bg-muted/80 hover:bg-muted transition-colors"
								>
									<Code2 className="mr-1 h-3 w-3" />
									{tag}
								</Badge>
							))}
						</div>

						{/* Actions */}
						<div className="flex flex-col sm:flex-row gap-3 pt-2">
							<Button asChild className="flex-1 gap-2 font-semibold">
								<a
									href={template.href}
									target="_blank"
									rel="noopener noreferrer"
								>
									<Github className="h-4 w-4" />
									View on GitHub
									<ArrowUpRight className="h-4 w-4 opacity-50 group-hover:opacity-100 transition-opacity" />
								</a>
							</Button>
							<Button
								variant="outline"
								className="gap-2"
								onClick={() => copyToClipboard(template.href)}
							>
								{copiedUrl === template.href ? (
									<>
										<Check className="h-4 w-4 text-green-500" />
										Copied!
									</>
								) : (
									<>
										<Copy className="h-4 w-4" />
										Clone
									</>
								)}
							</Button>
						</div>
					</div>

					{/* Bottom accent line */}
					<div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
				</Card>
			))}

			{/* Placeholder card for upcoming templates */}
			<Card className="relative overflow-hidden border-dashed border-2 bg-muted/20 hover:bg-muted/30 transition-colors duration-300">
				<div className="p-6 space-y-6 flex flex-col items-center justify-center min-h-[320px] text-center">
					<div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
						<Sparkles className="h-8 w-8 text-muted-foreground" />
					</div>
					<div className="space-y-2">
						<h3 className="text-xl font-semibold text-muted-foreground">
							More Coming Soon
						</h3>
						<p className="text-sm text-muted-foreground/80">
							We&apos;re working on more templates. Have a suggestion?
						</p>
					</div>
					<Button variant="outline" asChild>
						<a
							href="https://github.com/theopenco/llmgateway-templates/issues/new"
							target="_blank"
							rel="noopener noreferrer"
						>
							Request a Template
						</a>
					</Button>
				</div>
			</Card>
		</div>
	);
}
