"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/**
 * The DevPass README badge snippet. Lives on the edit-profile page only — it's
 * a tool for the profile owner to embed in their own GitHub README, not
 * something public visitors need to see. `baseUrl` is the deployment's public
 * origin so preview/staging/self-hosted builds generate correct links.
 */
export function ProfileReadmeBadge({
	username,
	baseUrl,
}: {
	username: string;
	baseUrl: string;
}) {
	const [copied, setCopied] = useState(false);

	const profileUrl = `${baseUrl}/profiles/${username}`;
	const badgeMarkdown = `[![Powered by DevPass](${baseUrl}/devpass-badge.svg)](${profileUrl})`;

	const copy = async () => {
		if (!navigator.clipboard?.writeText) {
			return;
		}
		try {
			await navigator.clipboard.writeText(badgeMarkdown);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			setCopied(false);
		}
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<img
					src={`${baseUrl}/devpass-badge.svg`}
					alt="Powered by DevPass"
					className="h-5"
				/>
				<p className="text-xs text-muted-foreground">
					Show it off in your GitHub README
				</p>
			</div>
			<div className="relative overflow-hidden rounded-lg border border-border/60 bg-background">
				<pre className="overflow-x-auto px-3 py-2.5 pr-10 font-mono text-[11px] leading-5 text-foreground/80">
					{badgeMarkdown}
				</pre>
				<button
					type="button"
					onClick={copy}
					aria-label="Copy badge markdown"
					className="absolute right-1.5 top-1.5 rounded-md border border-border/60 bg-card p-1.5 text-muted-foreground transition-colors hover:text-foreground"
				>
					{copied ? (
						<Check className="h-3.5 w-3.5 text-emerald-500" />
					) : (
						<Copy className="h-3.5 w-3.5" />
					)}
				</button>
			</div>
		</div>
	);
}
