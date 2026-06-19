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
		description: "GPT, Claude, Gemini & 280+ models — switch mid-conversation",
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
	description = "Chat, images, video, canvas and group chat across 280+ models. Free to start — no credit card required.",
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
		<div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-background/95 p-4 backdrop-blur-sm">
			<div className="my-8 w-full max-w-lg rounded-2xl border bg-card p-8 shadow-2xl">
				<div className="flex items-center gap-2">
					<Logo className="size-6" />
					<span className="text-base font-semibold">LLM Gateway</span>
					<Badge>Chat</Badge>
				</div>

				<h1 className="mt-6 text-2xl font-semibold leading-tight tracking-tight">
					{title}
				</h1>
				<p className="mt-3 text-sm text-muted-foreground">{description}</p>

				<div className="mt-6 flex items-center gap-3">
					{PROVIDER_LOGOS.map((provider) => {
						const Icon = getProviderIcon(provider);
						return (
							<Icon
								key={provider}
								className="size-6 shrink-0 text-muted-foreground/70 dark:text-white/80"
								aria-hidden
							/>
						);
					})}
				</div>

				<div className="mt-6 grid gap-2.5 sm:grid-cols-2">
					{FEATURES.map((feature) => {
						const Icon = feature.icon;
						return (
							<div
								key={feature.title}
								className="flex items-start gap-3 rounded-xl border bg-background/40 p-3"
							>
								<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
									<Icon className="size-4" aria-hidden />
								</span>
								<div className="min-w-0">
									<div className="text-sm font-medium leading-tight">
										{feature.title}
									</div>
									<p className="mt-0.5 text-xs text-muted-foreground">
										{feature.description}
									</p>
								</div>
							</div>
						);
					})}
				</div>

				<ul className="mt-5 space-y-2.5">
					{HIGHLIGHTS.map((highlight) => (
						<li
							key={highlight}
							className="flex items-start gap-2.5 text-sm text-foreground/80"
						>
							<CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
							<span>{highlight}</span>
						</li>
					))}
				</ul>

				<div className="mt-8 flex flex-col gap-3">
					<Button size="lg" className="w-full" asChild>
						<Link href={signupUrl}>Start free</Link>
					</Button>
					<p className="text-center text-sm text-muted-foreground">
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
