"use client";

import { Check, Link2 } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";

import { formatTokens } from "@/app/dashboard/components/coding-agents-shared";
import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/useUser";

import type { ProfileData } from "@/components/profile/ProfileView";

export const PROFILE_SITE_URL = "https://devpass.llmgateway.io";

export function XIcon({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" className={className} aria-hidden="true">
			<path
				fill="currentColor"
				d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
			/>
		</svg>
	);
}

export function LinkedInIcon({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" className={className} aria-hidden="true">
			<path
				fill="currentColor"
				d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z"
			/>
		</svg>
	);
}

interface ProfileShareActionsProps {
	profile: ProfileData;
	/** Where the actions are rendered, for analytics (e.g. "profile_header"). */
	location: string;
	variant?: "full" | "compact";
}

export function ProfileShareActions({
	profile,
	location,
	variant = "full",
}: ProfileShareActionsProps) {
	const posthog = usePostHog();
	const { user } = useUser();
	const [copied, setCopied] = useState(false);

	const handle = profile.username ?? "";
	if (!handle) {
		return null;
	}

	const profileUrl = `${PROFILE_SITE_URL}/profiles/${handle}`;
	const isOwner = !!user && user.username === profile.username;
	const displayName = profile.name?.trim() || `@${handle}`;
	const statsLine = `${formatTokens(profile.stats.totalTokens)} tokens routed, ${profile.stats.activeDays} active days, ${profile.stats.currentStreak}-day streak`;

	const xText = isOwner
		? `My DevPass coding profile: ${statsLine}. One key, every model.`
		: `${displayName}'s DevPass coding profile: ${statsLine}. One key, every model.`;
	const xUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(
		xText,
	)}&url=${encodeURIComponent(profileUrl)}`;

	const linkedInText = isOwner
		? `My AI coding activity on DevPass: ${statsLine}.\n\nOne key, every model — Claude, GPT, Gemini and more.\n\n${profileUrl}`
		: `${displayName}'s AI coding activity on DevPass: ${statsLine}.\n\n${profileUrl}`;
	const linkedInUrl = `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(
		linkedInText,
	)}`;

	const trackShare = (network: "x" | "linkedin" | "copy_link") => {
		posthog.capture("profile_share_clicked", {
			app: "code",
			network,
			location,
			profileUsername: handle,
			isOwner,
		});
	};

	const copyLink = async () => {
		trackShare("copy_link");
		if (!navigator.clipboard?.writeText) {
			return;
		}
		try {
			await navigator.clipboard.writeText(profileUrl);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			setCopied(false);
		}
	};

	if (variant === "compact") {
		return (
			<div className="flex items-center gap-1.5">
				<span className="mr-1 hidden text-xs font-medium text-muted-foreground sm:inline">
					Share
				</span>
				<Button variant="outline" size="icon-sm" asChild>
					<a
						href={xUrl}
						target="_blank"
						rel="noopener noreferrer"
						aria-label="Share on X"
						title="Share on X"
						onClick={() => trackShare("x")}
					>
						<XIcon className="h-3.5 w-3.5" />
					</a>
				</Button>
				<Button variant="outline" size="icon-sm" asChild>
					<a
						href={linkedInUrl}
						target="_blank"
						rel="noopener noreferrer"
						aria-label="Share on LinkedIn"
						title="Share on LinkedIn"
						onClick={() => trackShare("linkedin")}
					>
						<LinkedInIcon className="h-3.5 w-3.5" />
					</a>
				</Button>
				<Button
					variant="outline"
					size="icon-sm"
					onClick={copyLink}
					aria-label="Copy profile link"
					title="Copy profile link"
				>
					{copied ? (
						<Check className="h-3.5 w-3.5 text-emerald-500" />
					) : (
						<Link2 className="h-3.5 w-3.5" />
					)}
				</Button>
			</div>
		);
	}

	return (
		<div className="flex flex-wrap gap-2">
			<Button className="gap-2" asChild>
				<a
					href={xUrl}
					target="_blank"
					rel="noopener noreferrer"
					onClick={() => trackShare("x")}
				>
					<XIcon className="h-4 w-4" />
					Share on X
				</a>
			</Button>
			<Button variant="outline" className="gap-2" asChild>
				<a
					href={linkedInUrl}
					target="_blank"
					rel="noopener noreferrer"
					onClick={() => trackShare("linkedin")}
				>
					<LinkedInIcon className="h-4 w-4" />
					Share on LinkedIn
				</a>
			</Button>
			<Button variant="outline" className="gap-2" onClick={copyLink}>
				{copied ? (
					<Check className="h-4 w-4 text-emerald-500" />
				) : (
					<Link2 className="h-4 w-4" />
				)}
				{copied ? "Copied" : "Copy link"}
			</Button>
		</div>
	);
}
