import { ArrowRight, Clock, Sparkles, Terminal, Zap } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { Card } from "@/lib/components/card";

import {
	AnthropicIcon,
	AutohandIcon,
	CodexIcon,
	OpenClawIcon,
	ClineIcon,
	CursorIcon,
	N8nIcon,
	OpenCodeIcon,
	VSCodeIcon,
} from "@llmgateway/shared/components";

import type { ComponentType, SVGProps } from "react";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

interface Integration {
	name: string;
	description: string;
	href: string;
	icon: IconComponent;
	comingSoon: boolean;
	badge?: string;
}

const integrations: Integration[] = [
	{
		name: "Autohand",
		description:
			"Use LLM Gateway with Autohand for autonomous AI-powered coding in your terminal, IDE, and Slack.",
		href: "/guides/autohand",
		icon: AutohandIcon,
		comingSoon: false,
	},
	{
		name: "Claude Code",
		description:
			"Use LLM Gateway with Claude Code for AI-powered terminal assistance and coding.",
		href: "/guides/claude-code",
		icon: AnthropicIcon,
		comingSoon: false,
	},
	{
		name: "Cursor",
		description:
			"Use LLM Gateway with Cursor IDE for AI-powered code editing and chat.",
		href: "https://docs.llmgateway.io/guides/cursor",
		icon: CursorIcon,
		comingSoon: false,
		badge: "Plan mode only",
	},
	{
		name: "Codex CLI",
		description:
			"Use LLM Gateway with OpenAI's Codex CLI for AI-powered terminal coding.",
		href: "/guides/codex-cli",
		icon: CodexIcon,
		comingSoon: false,
	},
	{
		name: "Cline",
		description:
			"Use LLM Gateway with Cline for AI-powered coding assistance in VS Code.",
		href: "https://docs.llmgateway.io/guides/cline",
		icon: ClineIcon,
		comingSoon: false,
	},
	{
		name: "n8n",
		description:
			"Connect n8n workflow automation to LLM Gateway for AI-powered workflows.",
		href: "https://docs.llmgateway.io/guides/n8n",
		icon: N8nIcon,
		comingSoon: false,
	},
	{
		name: "OpenCode",
		description:
			"Use LLM Gateway with OpenCode for AI-powered development workflows.",
		href: "/guides/opencode",
		icon: OpenCodeIcon,
		comingSoon: false,
	},
	{
		name: "OpenClaw",
		description:
			"Use LLM Gateway with OpenClaw for AI-powered chat across Discord, WhatsApp, Telegram, and more.",
		href: "/guides/openclaw",
		icon: OpenClawIcon,
		comingSoon: false,
	},
	{
		name: "VS Code",
		description:
			"Native VS Code integration for AI-powered code completion and chat.",
		href: "#",
		icon: VSCodeIcon,
		comingSoon: true,
	},
];

function DevPlansCta() {
	return (
		<a
			href="https://code.llmgateway.io"
			target="_blank"
			rel="noopener noreferrer"
			className="group relative mb-10 block overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background via-background to-muted/40 transition-all duration-500 hover:border-foreground/20 hover:shadow-[0_0_40px_-12px_rgba(0,0,0,0.15)] dark:hover:shadow-[0_0_40px_-12px_rgba(255,255,255,0.06)]"
		>
			<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-foreground/[0.03] via-transparent to-transparent" />
			<div className="relative flex flex-col gap-8 p-8 sm:p-10 md:flex-row md:items-center md:justify-between md:gap-12">
				<div className="flex-1 space-y-4">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-foreground text-background">
							<Terminal className="h-5 w-5" strokeWidth={1.5} />
						</div>
						<h3 className="text-xl font-semibold tracking-tight sm:text-2xl">
							Dev Plans
						</h3>
						<Badge className="border-transparent bg-foreground/10 text-foreground text-[11px] font-medium tracking-wide uppercase">
							New
						</Badge>
					</div>
					<p className="max-w-lg text-[15px] leading-relaxed text-muted-foreground">
						Fixed-price monthly plans for Claude Code, Cursor, Cline, and every
						coding tool. One API key, 200+ models, predictable billing.
					</p>
					<div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-sm text-muted-foreground">
						<span className="flex items-center gap-1.5">
							<Zap className="h-3.5 w-3.5" />
							From $29/mo
						</span>
						<span className="hidden sm:inline text-border">|</span>
						<span className="flex items-center gap-1.5">
							<Sparkles className="h-3.5 w-3.5" />
							Every model included
						</span>
					</div>
				</div>
				<div className="shrink-0">
					<Button
						size="lg"
						className="pointer-events-none gap-2 rounded-lg px-6 text-sm font-medium"
						tabIndex={-1}
					>
						Get started
						<ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
					</Button>
				</div>
			</div>
		</a>
	);
}

export function IntegrationCards() {
	return (
		<div>
			<DevPlansCta />
			<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
				{integrations.map((integration) => {
					const isExternal = integration.href.startsWith("http");
					const cardContent = (
						<Card
							className={`relative h-full p-6 transition-all duration-300 ${
								integration.comingSoon
									? "opacity-60 cursor-not-allowed"
									: "hover:border-primary/50 hover:shadow-lg"
							}`}
						>
							{integration.comingSoon && (
								<Badge
									variant="secondary"
									className="absolute top-4 right-4 gap-1"
								>
									<Clock className="h-3 w-3" />
									Coming Soon
								</Badge>
							)}
							{integration.badge && !integration.comingSoon && (
								<Badge variant="outline" className="absolute top-4 right-4">
									{integration.badge}
								</Badge>
							)}
							<div className="flex items-start gap-4">
								<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
									<integration.icon className="h-6 w-6" />
								</div>
								<div className="flex-1 space-y-2">
									<div className="flex items-center gap-2">
										<h3 className="font-semibold">{integration.name}</h3>
										{!integration.comingSoon && (
											<ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 -translate-x-2 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
										)}
									</div>
									<p className="text-sm text-muted-foreground leading-relaxed">
										{integration.description}
									</p>
								</div>
							</div>
						</Card>
					);

					if (integration.comingSoon) {
						return <div key={integration.name}>{cardContent}</div>;
					}

					if (isExternal) {
						return (
							<a
								key={integration.name}
								href={integration.href}
								target="_blank"
								rel="noopener noreferrer"
								className="group"
							>
								{cardContent}
							</a>
						);
					}

					return (
						<Link
							key={integration.name}
							href={integration.href as any}
							className="group"
						>
							{cardContent}
						</Link>
					);
				})}
			</div>
		</div>
	);
}
