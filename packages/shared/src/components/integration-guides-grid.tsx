"use client";

import { ArrowUpRight, Clock, Search } from "lucide-react";
import { useMemo, useState } from "react";

import {
	AutohandIcon,
	ClineIcon,
	CodexIcon,
	ContinueIcon,
	CursorIcon,
	DevPassCodeIcon,
	HermesIcon,
	KiloCodeIcon,
	KimiIcon,
	N8nIcon,
	OpenClawIcon,
	OpenCodeIcon,
	PiIcon,
	VSCodeIcon,
} from "./integration-icons";
import { AnthropicIcon } from "./provider-icons";

import type { ComponentType, SVGProps } from "react";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export interface IntegrationGuide {
	name: string;
	description: string;
	href: string;
	icon: IconComponent;
	comingSoon: boolean;
	badge?: string;
}

export const DEFAULT_INTEGRATION_GUIDES: IntegrationGuide[] = [
	{
		name: "DevPass Code",
		description:
			"Our open-source terminal coding agent built for LLM Gateway. One browser login, every model, no per-provider keys.",
		href: "/guides/devpass-code",
		icon: DevPassCodeIcon,
		comingSoon: false,
	},
	{
		name: "Autohand Code",
		description:
			"Use LLM Gateway with Autohand Code for autonomous AI-powered coding in your terminal, IDE, and Slack.",
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
			"Use LLM Gateway with Cursor IDE in plan mode only. Cursor's coding agent does not work with external API endpoints.",
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
		name: "Continue CLI",
		description:
			"Use LLM Gateway with Continue's open-source AI code assistant CLI.",
		href: "/guides/continue",
		icon: ContinueIcon,
		comingSoon: false,
	},
	{
		name: "Hermes Agent",
		description:
			"Use LLM Gateway with Nous Research's Hermes Agent for terminal-based AI coding.",
		href: "/guides/hermes-agent",
		icon: HermesIcon,
		comingSoon: false,
	},
	{
		name: "Kilo Code",
		description:
			"Use LLM Gateway with Kilo Code in VS Code for autonomous AI coding with built-in provider support.",
		href: "/guides/kilo-code",
		icon: KiloCodeIcon,
		comingSoon: false,
	},
	{
		name: "Kimi Code",
		description:
			"Use LLM Gateway with Kimi Code CLI for autonomous terminal-based AI coding.",
		href: "/guides/kimi-code",
		icon: KimiIcon,
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
			"Use LLM Gateway with OpenCode CLI for AI-powered development workflows.",
		href: "/guides/opencode",
		icon: OpenCodeIcon,
		comingSoon: false,
	},
	{
		name: "OpenCode Desktop",
		description:
			"Use LLM Gateway with OpenCode Desktop app — connect via GUI, no config files needed.",
		href: "/guides/opencode-desktop",
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
		name: "Pi",
		description:
			"Use LLM Gateway with Pi coding agent for AI-powered terminal coding with any model.",
		href: "/guides/pi",
		icon: PiIcon,
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

interface IntegrationGuidesGridProps {
	guides?: IntegrationGuide[];
	/** Render an internal link (e.g. wrap next/link). Defaults to a plain `<a>`. */
	renderInternalLink?: (props: {
		href: string;
		className?: string;
		children: React.ReactNode;
	}) => React.ReactNode;
	/**
	 * Prefix for internal `/guides/...` hrefs. Use to point to a different
	 * origin (e.g. "https://llmgateway.io") when consuming from another app.
	 * When set, the prefix is prepended and the link is rendered as external.
	 */
	internalHrefPrefix?: string;
	/** Optional header above the search input. */
	header?: React.ReactNode;
}

function GuideCard({ guide }: { guide: IntegrationGuide }) {
	const Icon = guide.icon;
	return (
		<>
			<div
				aria-hidden
				className="absolute inset-0 opacity-0 transition-opacity duration-700 group-hover:opacity-100 bg-[radial-gradient(circle_at_top_right,_hsl(var(--foreground)/0.05),_transparent_60%)] dark:bg-[radial-gradient(circle_at_top_right,_hsl(var(--foreground)/0.06),_transparent_60%)]"
			/>
			<div className="relative flex items-start gap-4">
				<div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-gradient-to-br from-muted/40 to-muted/10 transition-all duration-500 group-hover:border-foreground/20 group-hover:from-muted/60">
					<Icon className="h-7 w-7" />
				</div>
				<div className="min-w-0 flex-1 space-y-1.5">
					<div className="flex items-start justify-between gap-3">
						<h3 className="text-[15px] font-semibold tracking-tight">
							{guide.name}
						</h3>
						{!guide.comingSoon && (
							<ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40 transition-all duration-500 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
						)}
					</div>
					<p className="text-[13.5px] leading-relaxed text-muted-foreground">
						{guide.description}
					</p>
					{(guide.comingSoon || guide.badge) && (
						<div className="pt-1">
							{guide.comingSoon ? (
								<span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
									<Clock className="h-2.5 w-2.5" />
									Coming soon
								</span>
							) : (
								<span className="inline-flex items-center rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
									{guide.badge}
								</span>
							)}
						</div>
					)}
				</div>
			</div>
		</>
	);
}

const CARD_CLASSES =
	"group relative overflow-hidden rounded-2xl border border-border/50 bg-card p-6 transition-all duration-500 ease-out hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.12)] dark:hover:shadow-[0_8px_30px_-12px_rgba(255,255,255,0.06)]";
const CARD_DISABLED_CLASSES =
	"group relative overflow-hidden rounded-2xl border border-border/50 bg-card p-6 opacity-60 cursor-not-allowed";

export function IntegrationGuidesGrid({
	guides = DEFAULT_INTEGRATION_GUIDES,
	renderInternalLink,
	internalHrefPrefix,
	header,
}: IntegrationGuidesGridProps) {
	const [query, setQuery] = useState("");

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) {
			return guides;
		}
		return guides.filter(
			(g) =>
				g.name.toLowerCase().includes(q) ||
				g.description.toLowerCase().includes(q),
		);
	}, [guides, query]);

	return (
		<div>
			{header}
			<div className="mb-8 flex h-12 w-full items-center gap-3 rounded-xl border border-border/60 bg-card/40 px-4 backdrop-blur-sm">
				<Search className="h-4 w-4 shrink-0 text-muted-foreground/60" />
				<input
					type="search"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search guides…"
					aria-label="Search guides"
					className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none ring-0 placeholder:text-muted-foreground/60 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
				/>
			</div>

			{filtered.length === 0 ? (
				<div className="rounded-2xl border border-dashed border-border/60 bg-card/30 py-16 text-center">
					<p className="italic text-muted-foreground">
						No guides match &ldquo;{query}&rdquo;.
					</p>
					<p className="mt-1 text-xs text-muted-foreground/70">
						Try a different keyword, or clear the search to see all
						integrations.
					</p>
				</div>
			) : (
				<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
					{filtered.map((guide) => {
						const isExternal = guide.href.startsWith("http");
						const resolvedHref =
							!isExternal && internalHrefPrefix
								? `${internalHrefPrefix.replace(/\/$/, "")}${guide.href}`
								: guide.href;
						const treatAsExternal = isExternal || !!internalHrefPrefix;

						if (guide.comingSoon) {
							return (
								<div key={guide.name} className={CARD_DISABLED_CLASSES}>
									<GuideCard guide={guide} />
								</div>
							);
						}

						if (treatAsExternal) {
							return (
								<a
									key={guide.name}
									href={resolvedHref}
									target="_blank"
									rel="noopener noreferrer"
									className={CARD_CLASSES}
								>
									<GuideCard guide={guide} />
								</a>
							);
						}

						if (renderInternalLink) {
							return (
								<div key={guide.name}>
									{renderInternalLink({
										href: resolvedHref,
										className: CARD_CLASSES,
										children: <GuideCard guide={guide} />,
									})}
								</div>
							);
						}

						return (
							<a key={guide.name} href={resolvedHref} className={CARD_CLASSES}>
								<GuideCard guide={guide} />
							</a>
						);
					})}
				</div>
			)}
		</div>
	);
}
