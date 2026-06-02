import { buttonVariants } from "fumadocs-ui/components/ui/button";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { MessageCircleIcon } from "lucide-react";

import { baseOptions } from "@/app/layout.config";
import {
	AISearch,
	AISearchPanel,
	AISearchTrigger,
} from "@/components/ai/search";
import { cn } from "@/lib/cn";
import { source } from "@/lib/source";

import type { DocsLayoutProps } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";

const docsOptions: DocsLayoutProps = {
	...baseOptions,

	tree: source.pageTree,

	links: [],

	sidebar: {
		footer: (
			<a
				href="https://status.llmgateway.io/"
				target="_blank"
				rel="noopener noreferrer"
				className="flex items-center justify-center gap-2 py-2 text-xs text-fd-muted-foreground hover:text-fd-foreground transition-colors"
			>
				<span className="relative flex h-2 w-2">
					<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
					<span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
				</span>
				All systems operational
			</a>
		),
	},
};

export default function Layout({ children }: { children: ReactNode }) {
	return (
		<DocsLayout {...docsOptions}>
			<AISearch>
				<AISearchPanel />
				<AISearchTrigger
					position="float"
					className={cn(
						buttonVariants({
							color: "secondary",
							className: "text-fd-muted-foreground rounded-2xl",
						}),
					)}
				>
					<MessageCircleIcon className="size-4.5" />
					Ask AI
				</AISearchTrigger>
			</AISearch>
			{children}
		</DocsLayout>
	);
}
