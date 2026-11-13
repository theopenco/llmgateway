"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { badgeHtml, badgeMarkdown, type Badge } from "@/lib/badges";
import { Button } from "@/lib/components/button";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/lib/components/tabs";

const COPIED_MS = 2000;

export function BadgeSnippet({ badge }: { badge: Badge }) {
	const [copied, setCopied] = useState<string | null>(null);
	const snippets = [
		{ id: "markdown", label: "Markdown", code: badgeMarkdown(badge) },
		{ id: "html", label: "HTML", code: badgeHtml(badge) },
		{ id: "url", label: "Image URL", code: badge.imageUrl },
	];

	const copy = async (id: string, code: string) => {
		await navigator.clipboard.writeText(code);
		setCopied(id);
		setTimeout(() => setCopied(null), COPIED_MS);
	};

	return (
		<div className="space-y-4">
			<div className="flex min-h-16 items-center justify-center rounded-lg border bg-muted/30 p-4">
				{/* An external SVG with live data; next/image would cache and re-encode it. */}
				<img src={badge.imageUrl} alt={badge.alt} height={20} />
			</div>
			<Tabs defaultValue="markdown">
				<TabsList>
					{snippets.map((snippet) => (
						<TabsTrigger key={snippet.id} value={snippet.id}>
							{snippet.label}
						</TabsTrigger>
					))}
				</TabsList>
				{snippets.map((snippet) => (
					<TabsContent key={snippet.id} value={snippet.id}>
						<div className="flex items-start gap-2">
							<pre className="min-w-0 flex-1 overflow-x-auto rounded-lg border bg-muted/30 p-3 text-xs">
								<code>{snippet.code}</code>
							</pre>
							<Button
								type="button"
								variant="outline"
								size="icon"
								aria-label={`Copy ${snippet.label}`}
								onClick={() => copy(snippet.id, snippet.code)}
							>
								{copied === snippet.id ? (
									<Check className="size-4" aria-hidden="true" />
								) : (
									<Copy className="size-4" aria-hidden="true" />
								)}
							</Button>
						</div>
					</TabsContent>
				))}
			</Tabs>
		</div>
	);
}
