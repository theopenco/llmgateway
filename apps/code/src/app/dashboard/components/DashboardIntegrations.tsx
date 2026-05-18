"use client";

import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";

import {
	AnthropicIcon,
	KiloCodeIcon,
	OpenCodeIcon,
	SoulForgeIcon,
} from "@llmgateway/shared/components";

import type { ComponentType, SVGProps } from "react";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

interface Integration {
	name: string;
	description: string;
	href: string;
	icon: IconComponent;
	external: boolean;
}

const integrations: Integration[] = [
	{
		name: "OpenCode",
		description: "AI dev workflows",
		href: "/guides/opencode",
		icon: OpenCodeIcon,
		external: false,
	},
	{
		name: "Claude Code",
		description: "Terminal AI assistant",
		href: "/guides/claude-code",
		icon: AnthropicIcon,
		external: false,
	},
	{
		name: "SoulForge",
		description: "Soul AI coding agent",
		href: "https://soulforge.proxysoul.com/",
		icon: SoulForgeIcon,
		external: true,
	},
	{
		name: "Kilo Code",
		description: "VS Code autonomous agent",
		href: "/guides/kilo-code",
		icon: KiloCodeIcon,
		external: false,
	},
];

export default function DashboardIntegrations() {
	return (
		<div>
			<div className="mb-4 flex items-end justify-between gap-3">
				<h2 className="font-semibold tracking-tight">Integrations</h2>
				<Link
					href="/guides"
					className="group inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
				>
					See more guides
					<ArrowRight className="h-3 w-3 transition-transform duration-300 group-hover:translate-x-0.5" />
				</Link>
			</div>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{integrations.map((integration) => {
					const Icon = integration.icon;
					const content = (
						<>
							<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-gradient-to-br from-muted/40 to-muted/10 transition-all duration-500 group-hover:border-foreground/20 group-hover:from-muted/60">
								<Icon className="h-4.5 w-4.5" />
							</div>
							<div className="min-w-0 flex-1">
								<div className="flex items-center justify-between gap-2">
									<span className="text-sm font-medium tracking-tight">
										{integration.name}
									</span>
									<ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-all duration-500 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
								</div>
								<p className="truncate text-xs text-muted-foreground">
									{integration.description}
								</p>
							</div>
						</>
					);
					const className =
						"group relative flex items-center gap-3 overflow-hidden rounded-xl border border-border/50 bg-card p-4 transition-all duration-500 ease-out hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.12)] dark:hover:shadow-[0_8px_30px_-12px_rgba(255,255,255,0.06)]";
					return integration.external ? (
						<a
							key={integration.name}
							href={integration.href}
							target="_blank"
							rel="noopener noreferrer"
							className={className}
						>
							{content}
						</a>
					) : (
						<Link
							key={integration.name}
							href={integration.href as never}
							className={className}
						>
							{content}
						</Link>
					);
				})}
			</div>
		</div>
	);
}
