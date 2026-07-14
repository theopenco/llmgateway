"use client";
import { DotsHorizontalIcon } from "@radix-ui/react-icons";
import { MonitorSmartphone, HelpCircle, Plus } from "lucide-react";
import Link from "next/link";
import React, { useRef } from "react";

import { Button } from "@/lib/components/button";
import {
	Tooltip,
	TooltipProvider,
	TooltipTrigger,
	TooltipContent,
} from "@/lib/components/tooltip";
import Logo from "@/lib/icons/Logo";
import { cn } from "@/lib/utils";

import { MARKETING_STATS } from "@llmgateway/shared";
import { ProviderIcons } from "@llmgateway/shared/components";

import { AnimatedBeam } from "./animated-beam";

const Circle = ({
	ref,
	className,
	children,
}: { className?: string; children?: React.ReactNode } & {
	ref?: React.RefObject<HTMLDivElement | null>;
}) => {
	return (
		<div
			ref={ref}
			className={cn(
				"group relative z-10 flex size-14 items-center justify-center rounded-full border-2 bg-white p-3 shadow-lg shadow-black/5 dark:shadow-black/20 backdrop-blur-sm dark:bg-black dark:border-neutral-800",
				className,
			)}
		>
			{children}
		</div>
	);
};

Circle.displayName = "Circle";

const stats = [
	{ value: MARKETING_STATS.providers, label: "Providers" },
	{ value: MARKETING_STATS.models, label: "Models" },
	{ value: MARKETING_STATS.tokensRouted, label: "Tokens routed" },
];

export function Graph() {
	const containerRef = useRef<HTMLDivElement>(null);
	const leftRef = useRef<HTMLDivElement>(null);
	const centerRef = useRef<HTMLDivElement>(null);
	const rightRefs = [
		useRef<HTMLDivElement>(null),
		useRef<HTMLDivElement>(null),
		useRef<HTMLDivElement>(null),
		useRef<HTMLDivElement>(null),
		useRef<HTMLDivElement>(null),
		useRef<HTMLDivElement>(null),
	];

	const OpenAIIcon = ProviderIcons.openai;
	const AnthropicIcon = ProviderIcons.anthropic;
	const XAIIcon = ProviderIcons.xai;
	const DeepseekIcon = ProviderIcons.deepseek;

	const providerNodes = [
		{
			href: "/providers/openai",
			label: "View OpenAI models",
			icon: <OpenAIIcon className="w-6 h-6 object-contain" />,
		},
		{
			href: "/providers/anthropic",
			label: "View Anthropic models",
			icon: <AnthropicIcon className="w-6 h-6 object-contain" />,
		},
		{
			href: "/providers/xai",
			label: "View xAI models",
			icon: <XAIIcon className="w-6 h-6 object-contain" />,
		},
		{
			href: "/providers",
			label: "View all providers",
			icon: <DotsHorizontalIcon className="w-6 h-6 object-contain" />,
		},
		{
			href: "/providers/deepseek",
			label: "View DeepSeek models",
			icon: <DeepseekIcon className="w-6 h-6 object-contain" />,
		},
	];

	return (
		<div className="relative w-full py-28 md:py-36 px-4 overflow-hidden">
			{/* Gradient background */}
			<div className="absolute inset-0 bg-gradient-to-b from-background via-surface-elevated to-background" />
			{/* Noise texture */}
			<div className="absolute inset-0 bg-noise" />

			<div className="relative">
				{/* Header */}
				<div className="container mx-auto px-4">
					<div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8 mb-4">
						<div>
							<p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-4">
								How It Works
							</p>
							<h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight text-foreground">
								One request. Any model.
							</h2>
							<p className="mt-4 text-muted-foreground max-w-xl">
								Your app sends one request. We route it to OpenAI, Anthropic,
								Google, or any of {MARKETING_STATS.providers}{" "}
								providers—automatically picking the best path.
							</p>
						</div>
						<div className="flex gap-8 lg:gap-12">
							{stats.map((stat) => (
								<div key={stat.label}>
									<div className="font-display text-3xl md:text-4xl font-bold tabular-nums bg-gradient-to-b from-foreground to-foreground/60 bg-clip-text text-transparent">
										{stat.value}
									</div>
									<div className="text-sm text-muted-foreground">
										{stat.label}
									</div>
								</div>
							))}
						</div>
					</div>
				</div>

				{/* Diagram */}
				<div className="relative mx-auto max-w-4xl">
					{/* Faint radial glow behind center */}
					<div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-500/5 dark:bg-blue-400/5 rounded-full blur-3xl pointer-events-none" />

					<div
						className="relative flex h-[500px] items-center justify-center p-10"
						ref={containerRef}
					>
						<div className="absolute left-10 top-1/2 -translate-y-1/2 z-10">
							<Circle ref={leftRef}>
								<MonitorSmartphone className="text-black dark:text-white" />
							</Circle>
						</div>

						<div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
							<Circle ref={centerRef}>
								<Logo />
							</Circle>
						</div>

						<div className="absolute right-10 top-1/2 flex -translate-y-1/2 flex-col items-center justify-center gap-6 z-10">
							<TooltipProvider delayDuration={100}>
								{providerNodes.map((node, index) => (
									<Tooltip key={node.href}>
										<TooltipTrigger asChild>
											<Link
												href={node.href}
												prefetch={true}
												aria-label={node.label}
												className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
											>
												<Circle
													ref={rightRefs[index]}
													className="cursor-pointer transition-all duration-200 hover:scale-110 hover:border-neutral-300 dark:hover:border-neutral-600"
												>
													{node.icon}
												</Circle>
											</Link>
										</TooltipTrigger>
										<TooltipContent>{node.label}</TooltipContent>
									</Tooltip>
								))}

								<div className="relative group">
									<Tooltip>
										<TooltipTrigger>
											<Circle ref={rightRefs[5]}>
												<HelpCircle className="text-muted-foreground dark:text-neutral-400" />
											</Circle>
										</TooltipTrigger>
										<TooltipContent>
											Could be your model?{" "}
											<a
												href="mailto:contact@llmgateway.io"
												className="text-blue-500 underline"
												target="_blank"
												rel="noreferrer noopener"
											>
												Get in touch
											</a>
										</TooltipContent>
									</Tooltip>
								</div>
							</TooltipProvider>
						</div>

						<AnimatedBeam
							containerRef={containerRef}
							fromRef={leftRef}
							toRef={centerRef}
						/>
						{rightRefs.map((ref, i) => (
							<AnimatedBeam
								key={i}
								containerRef={containerRef}
								fromRef={centerRef}
								toRef={ref}
								curvature={(i - 2.5) * 20}
							/>
						))}
					</div>
				</div>

				<div className="flex justify-center space-x-6">
					<Button asChild>
						<Link href="/models" prefetch={true}>
							View all models
						</Link>
					</Button>
					<Button variant="outline" asChild>
						<a
							href="https://github.com/theopenco/llmgateway/issues/new?assignees=&labels=enhancement%2Cmodel-request&projects=&template=model-request.md&title=%5BModel+Request%5D+"
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-2"
						>
							<Plus className="h-4 w-4" />
							Request Model
						</a>
					</Button>
				</div>
			</div>
		</div>
	);
}
