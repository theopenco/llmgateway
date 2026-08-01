"use client";

import { ArrowUpRight, ChevronDownIcon, Globe } from "lucide-react";
import { useState } from "react";

import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import type { ComponentProps } from "react";

function safeHostname(url: string | undefined): string | null {
	if (!url) {
		return null;
	}
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return null;
	}
}

function SourceFavicon({ host }: { host: string | null }) {
	const [failed, setFailed] = useState(false);

	if (!host || failed) {
		return (
			<span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted">
				<Globe className="h-3 w-3 text-muted-foreground" />
			</span>
		);
	}

	return (
		<img
			src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
			alt=""
			className="h-5 w-5 shrink-0 rounded-full bg-muted"
			onError={() => setFailed(true)}
		/>
	);
}

export type SourcesProps = ComponentProps<"div">;

export const Sources = ({ className, ...props }: SourcesProps) => (
	<Collapsible className={cn("not-prose mb-4 mt-2", className)} {...props} />
);

export type SourcesTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
	count: number;
};

export const SourcesTrigger = ({
	className,
	count,
	children,
	...props
}: SourcesTriggerProps) => (
	<CollapsibleTrigger
		className={cn(
			"group/sources inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
			className,
		)}
		{...props}
	>
		{children ?? (
			<>
				<Globe className="h-3.5 w-3.5" />
				<span>
					{count} source{count === 1 ? "" : "s"}
				</span>
				<ChevronDownIcon className="h-3.5 w-3.5 transition-transform duration-200 group-data-[state=open]/sources:rotate-180" />
			</>
		)}
	</CollapsibleTrigger>
);

export type SourcesContentProps = ComponentProps<typeof CollapsibleContent>;

export const SourcesContent = ({
	className,
	...props
}: SourcesContentProps) => (
	<CollapsibleContent
		className={cn(
			"mt-2 grid gap-1.5 sm:grid-cols-2",
			"data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
			className,
		)}
		{...props}
	/>
);

export type SourceProps = ComponentProps<"a">;

export const Source = ({ href, title, children, ...props }: SourceProps) => {
	const host = safeHostname(href);
	// Some providers (e.g. Gemini grounding redirects) put the real domain in
	// the title while the href points at a redirect host.
	const titleIsDomain = !!title && !title.includes(" ") && title.includes(".");
	const label = title ?? host ?? href ?? "";

	return (
		<a
			className="group/source flex items-center gap-2.5 rounded-lg border border-border/60 bg-card px-3 py-2 transition-colors hover:border-border hover:bg-accent/40"
			href={href}
			rel="noreferrer"
			target="_blank"
			{...props}
		>
			{children ?? (
				<>
					<SourceFavicon host={titleIsDomain ? (title ?? null) : host} />
					<span className="min-w-0 flex-1">
						<span className="block truncate text-xs font-medium text-foreground">
							{label}
						</span>
						{!titleIsDomain && host && host !== label ? (
							<span className="block truncate text-[11px] text-muted-foreground">
								{host}
							</span>
						) : null}
					</span>
					<ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/source:opacity-100" />
				</>
			)}
		</a>
	);
};
