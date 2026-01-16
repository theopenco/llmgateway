import { ArrowRight, Clock } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/lib/components/badge";
import { Card } from "@/lib/components/card";

import {
	AnthropicIcon,
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
		name: "VS Code",
		description:
			"Native VS Code integration for AI-powered code completion and chat.",
		href: "#",
		icon: VSCodeIcon,
		comingSoon: true,
	},
];

export function IntegrationCards() {
	return (
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
	);
}
