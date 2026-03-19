"use client";

import {
	ArrowRight,
	Bandage,
	Braces,
	Brain,
	ChevronDown,
	ClipboardList,
	Columns3Cog,
	Database,
	DollarSign,
	Eye,
	Globe,
	Image,
	Key,
	Link as LinkIcon,
	MessageCircle,
	Route,
	Shield,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";

import type { ReactNode } from "react";

interface Feature {
	title: string;
	description: string;
	href: string;
	icon: ReactNode;
}

const features: Feature[] = [
	// Core gateway value
	{
		title: "Routing",
		description:
			"Intelligently route requests to the best available models and providers.",
		href: "/features/routing",
		icon: <Route className="size-5" />,
	},
	{
		title: "Caching",
		description: "Reduce costs and latency by caching identical requests.",
		href: "/features/caching",
		icon: <Zap className="size-5" />,
	},
	{
		title: "Image Generation",
		description:
			"Generate images using AI models through the OpenAI-compatible API.",
		href: "/features/image-generation",
		icon: <Image className="size-5" />,
	},
	// Model capabilities
	{
		title: "Web Search",
		description:
			"Enable real-time web search capabilities for up-to-date information.",
		href: "/features/web-search",
		icon: <Globe className="size-5" />,
	},
	{
		title: "Reasoning",
		description:
			"Use reasoning-capable models that show their step-by-step thought process.",
		href: "/features/reasoning",
		icon: <Brain className="size-5" />,
	},
	{
		title: "Vision",
		description:
			"Send images to vision-enabled models using URLs or inline base64 data.",
		href: "/features/vision",
		icon: <Eye className="size-5" />,
	},
	// Operations & management
	{
		title: "Cost Breakdown",
		description:
			"Get real-time cost information for each API request directly in the response.",
		href: "/features/cost-breakdown",
		icon: <DollarSign className="size-5" />,
	},
	{
		title: "API Keys & IAM",
		description:
			"Manage API keys with fine-grained access control and IAM rules.",
		href: "/features/api-keys",
		icon: <Key className="size-5" />,
	},
	{
		title: "Guardrails",
		description:
			"Protect your LLM usage with content guardrails that detect and block harmful content.",
		href: "/features/guardrails",
		icon: <Shield className="size-5" />,
	},
	{
		title: "Audit Logs",
		description:
			"Track all organization activity with comprehensive audit logs.",
		href: "/features/audit-logs",
		icon: <ClipboardList className="size-5" />,
	},
	// Developer experience & compatibility
	{
		title: "Custom Providers",
		description:
			"Integrate custom OpenAI-compatible providers for enhanced flexibility.",
		href: "/features/custom-providers",
		icon: <Columns3Cog className="size-5" />,
	},
	{
		title: "Anthropic API",
		description: "Access any model through the familiar Anthropic API format.",
		href: "/features/anthropic-endpoint",
		icon: <MessageCircle className="size-5" />,
	},
	{
		title: "Response Healing",
		description:
			"Automatically repair malformed JSON responses from AI models.",
		href: "/features/response-healing",
		icon: <Bandage className="size-5" />,
	},
	{
		title: "Data Retention",
		description:
			"Store and access your full request and response data for debugging and analytics.",
		href: "/features/data-retention",
		icon: <Database className="size-5" />,
	},
	{
		title: "Source Attribution",
		description:
			"Use the X-Source header to identify your domain for public usage statistics.",
		href: "/features/source",
		icon: <LinkIcon className="size-5" />,
	},
	{
		title: "Metadata",
		description:
			"Send additional context and metadata to LLM Gateway using custom headers.",
		href: "/features/metadata",
		icon: <Braces className="size-5" />,
	},
];

const INITIAL_COUNT = 6;

export function FeatureCards() {
	const posthog = usePostHog();
	const [expanded, setExpanded] = useState(false);

	const visible = expanded ? features : features.slice(0, INITIAL_COUNT);
	const remaining = features.length - INITIAL_COUNT;

	return (
		<div className="not-prose">
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{visible.map((feature) => (
					<Link
						key={feature.href}
						href={feature.href}
						onClick={() => {
							posthog.capture("docs_feature_card_click", {
								feature: feature.title,
								href: feature.href,
							});
						}}
						className="group relative flex flex-col gap-3 rounded-xl border border-fd-border bg-fd-card p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-fd-primary/40"
					>
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3">
								<div className="rounded-lg bg-fd-primary/10 p-2 text-fd-primary transition-colors duration-200 group-hover:bg-fd-primary/20">
									{feature.icon}
								</div>
								<h3 className="text-sm font-semibold tracking-tight text-fd-foreground">
									{feature.title}
								</h3>
							</div>
							<ArrowRight className="size-4 -translate-x-1 text-fd-muted-foreground opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 group-hover:text-fd-primary" />
						</div>
						<p className="text-[13px] leading-relaxed text-fd-muted-foreground">
							{feature.description}
						</p>
					</Link>
				))}
			</div>
			{!expanded && (
				<button
					type="button"
					onClick={() => setExpanded(true)}
					className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-fd-border bg-fd-card px-4 py-2.5 text-sm font-medium text-fd-muted-foreground transition-colors duration-200 hover:bg-fd-accent hover:text-fd-foreground"
				>
					Show {remaining} more features
					<ChevronDown className="size-4" />
				</button>
			)}
		</div>
	);
}
