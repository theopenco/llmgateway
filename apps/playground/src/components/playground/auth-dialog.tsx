"use client";

import {
	AudioLines,
	Film,
	ImagePlus,
	MessageSquare,
	PenTool,
	Users,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

import { getProviderIcon } from "@llmgateway/shared/components";

import type { LucideIcon } from "lucide-react";

interface AuthDialogProps {
	open: boolean;
	returnUrl?: string;
	title?: string;
	description?: string;
}

const PROVIDER_LOGOS = [
	"openai",
	"anthropic",
	"google-ai-studio",
	"mistral",
	"xai",
	"deepseek",
] as const;

interface Feature {
	icon: LucideIcon;
	title: string;
	description: string;
}

const FEATURES: Feature[] = [
	{
		icon: MessageSquare,
		title: "Chat",
		description: "GPT, Claude, Gemini & 200+ models — switch mid-conversation",
	},
	{
		icon: ImagePlus,
		title: "Image Studio",
		description: "Generate and edit images from a prompt",
	},
	{
		icon: Film,
		title: "Video Studio",
		description: "Turn a prompt into short videos",
	},
	{
		icon: AudioLines,
		title: "Audio Studio",
		description: "Turn text into natural-sounding speech",
	},
	{
		icon: PenTool,
		title: "Canvas",
		description: "Build and preview UIs with live output",
	},
	{
		icon: Users,
		title: "Group Chat",
		description: "Run several models side by side and compare",
	},
];

const HIGHLIGHTS = [
	"Save & search your full chat history",
	"Pay-as-you-go credits or a flat monthly plan — your call",
] as const;

export function AuthDialog({
	open,
	returnUrl,
	title = "Every model and studio — in one place",
	description = "Chat, images, video, canvas and group chat across 200+ models. Free to start — no credit card required.",
}: AuthDialogProps) {
	if (!open) {
		return null;
	}

	const loginUrl = returnUrl
		? `/login?returnUrl=${encodeURIComponent(returnUrl)}`
		: "/login";
	const signupUrl = returnUrl
		? `/signup?returnUrl=${encodeURIComponent(returnUrl)}`
		: "/signup";

	return (
		<div
			className="fixed inset-0 z-50 flex items-end justify-center bg-background/95 backdrop-blur-sm sm:items-center sm:p-4"
			role="dialog"
			aria-modal="true"
			aria-labelledby="auth-dialog-title"
		>
			<div className="flex max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border bg-card shadow-2xl sm:max-h-[90vh] sm:rounded-2xl">
				{/* Scrollable body */}
				<div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8">
					<div className="flex items-center gap-2">
						<Logo className="size-6" />
						<span className="text-base font-semibold">LLM Gateway</span>
						<Badge>Chat</Badge>
					</div>

					<h1
						id="auth-dialog-title"
						className="mt-5 text-xl font-semibold leading-tight tracking-tight sm:text-2xl"
					>
						{title}
					</h1>
					<p className="mt-2.5 text-sm text-muted-foreground">{description}</p>

					<div className="mt-5 flex items-center gap-3">
						{PROVIDER_LOGOS.map((provider) => {
							const Icon = getProviderIcon(provider);
							return (
								<Icon
									key={provider}
									className="size-5 shrink-0 text-muted-foreground/70 dark:text-white/80"
									aria-hidden
								/>
							);
						})}
					</div>

					<div className="mt-5 grid grid-cols-2 gap-2.5">
						{FEATURES.map((feature) => {
							const Icon = feature.icon;
							return (
								<div
									key={feature.title}
									className="flex flex-col gap-1.5 rounded-xl border bg-background/40 p-3"
								>
									<span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
										<Icon className="size-4" aria-hidden />
									</span>
									<div className="text-[13px] font-medium leading-tight">
										{feature.title}
									</div>
									<p className="text-[11px] leading-snug text-muted-foreground">
										{feature.description}
									</p>
								</div>
							);
						})}
					</div>

					<ul className="mt-5 space-y-2">
						{HIGHLIGHTS.map((highlight) => (
							<li
								key={highlight}
								className="flex items-start gap-2.5 text-xs text-foreground/80 sm:text-sm"
							>
								<CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
								<span>{highlight}</span>
							</li>
						))}
					</ul>
				</div>

				{/* Pinned action footer — keeps the primary CTA in view on mobile */}
				<div className="shrink-0 border-t bg-card/80 p-4 backdrop-blur supports-[backdrop-filter]:bg-card/60 sm:px-8 sm:py-6">
					<Button size="lg" className="w-full" asChild>
						<Link href={signupUrl}>Start free</Link>
					</Button>
					<p className="mt-3 text-center text-sm text-muted-foreground">
						Already have an account?{" "}
						<Link
							href={loginUrl}
							className={cn(
								"font-medium text-foreground underline-offset-4 hover:underline",
							)}
						>
							Sign in
						</Link>
					</p>
					<div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
						<Link
							href="/pricing"
							className="transition-colors hover:text-foreground"
						>
							Pricing
						</Link>
						<span className="text-muted-foreground/40">·</span>
						<Link
							href="/compare"
							className="transition-colors hover:text-foreground"
						>
							Compare vs ChatGPT, Claude &amp; more
						</Link>
					</div>
				</div>
			</div>
		</div>
	);
}

function CheckIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 20 20"
			fill="currentColor"
			aria-hidden
		>
			<path
				fillRule="evenodd"
				d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.5 7.6a1 1 0 0 1-1.42.006l-3.5-3.5a1 1 0 1 1 1.414-1.414l2.79 2.79 6.796-6.886a1 1 0 0 1 1.414-.006Z"
				clipRule="evenodd"
			/>
		</svg>
	);
}
