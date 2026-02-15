"use client";

import { Linkedin, Mail, MessageCircle, Rocket } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { useEffect, useState } from "react";

import { Button } from "@/lib/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/lib/components/dialog";
import { XIcon } from "@/lib/icons/XIcon";

function RedditIcon({ className }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="currentColor">
			<path d="M12 0C5.373 0 0 5.373 0 12c0 6.627 5.373 12 12 12s12-5.373 12-12C24 5.373 18.627 0 12 0zm6.066 13.71c.149.854-.068 1.707-.607 2.413-.54.706-1.342 1.176-2.25 1.32a12.1 12.1 0 0 1-3.209.427c-1.087 0-2.174-.142-3.209-.427-.908-.144-1.71-.614-2.25-1.32-.539-.706-.756-1.559-.607-2.413.098-.558.353-1.074.737-1.49a2.28 2.28 0 0 1-.134-.776c0-.636.259-1.212.677-1.629a2.298 2.298 0 0 1 1.629-.677c.592 0 1.136.228 1.542.6A9.7 9.7 0 0 1 12 8.88a9.7 9.7 0 0 1 1.615.358c.406-.372.95-.6 1.542-.6.636 0 1.212.259 1.629.677.417.417.677.993.677 1.629 0 .27-.048.53-.134.776.384.416.639.932.737 1.49zM9.5 12.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5zm5 0a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5zm-5.57 3.907c.28.185.6.323.94.407.68.168 1.39.253 2.13.253s1.45-.085 2.13-.253c.34-.084.66-.222.94-.407a.375.375 0 0 0-.416-.624c-.2.133-.43.232-.68.294a9.1 9.1 0 0 1-1.974.24 9.1 9.1 0 0 1-1.974-.24 2.2 2.2 0 0 1-.68-.294.375.375 0 0 0-.416.624zM17.5 7.5l-2.5-4.5h-1l1.5 4.5h2z" />
		</svg>
	);
}

function ProductHuntIcon({ className }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="currentColor">
			<path d="M13.604 8.4h-3.405V12h3.405a1.8 1.8 0 0 0 0-3.6zM12 0C5.372 0 0 5.372 0 12s5.372 12 12 12 12-5.372 12-12S18.628 0 12 0zm1.604 14.4h-3.405V18H8.4V6h5.204a4.2 4.2 0 0 1 0 8.4z" />
		</svg>
	);
}

const referralSources = [
	{
		value: "twitter",
		label: "X / Twitter",
		icon: <XIcon className="h-4 w-4" />,
	},
	{
		value: "email",
		label: "Email",
		icon: <Mail className="h-4 w-4" />,
	},
	{
		value: "reddit",
		label: "Reddit",
		icon: <RedditIcon className="h-4 w-4" />,
	},
	{
		value: "producthunt",
		label: "Product Hunt",
		icon: <ProductHuntIcon className="h-4 w-4" />,
	},
	{
		value: "devntell",
		label: "DevNTell",
		icon: <MessageCircle className="h-4 w-4" />,
	},
	{
		value: "linkedin",
		label: "LinkedIn",
		icon: <Linkedin className="h-4 w-4" />,
	},
	{
		value: "other",
		label: "Other",
		icon: <Rocket className="h-4 w-4" />,
	},
];

export function ReferralBanner() {
	const posthog = usePostHog();
	const [open, setOpen] = useState(false);

	useEffect(() => {
		const isDismissed = localStorage.getItem("referral_dismissed") === "true";
		if (!isDismissed) {
			setOpen(true);
		}
	}, []);

	const handleDismiss = () => {
		localStorage.setItem("referral_dismissed", "true");
		setOpen(false);
	};

	const handleSelect = (value: string) => {
		posthog.capture("referral_source_selected", { source: value });
		localStorage.setItem("referral_dismissed", "true");
		setOpen(false);
	};

	return (
		<Dialog open={open} onOpenChange={(v) => !v && handleDismiss()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>How did you find us?</DialogTitle>
					<DialogDescription>
						This helps us understand how people discover LLM Gateway.
					</DialogDescription>
				</DialogHeader>
				<div className="grid grid-cols-2 gap-2">
					{referralSources.map((source) => (
						<button
							key={source.value}
							onClick={() => handleSelect(source.value)}
							className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/50 px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-accent hover:text-accent-foreground"
						>
							{source.icon}
							{source.label}
						</button>
					))}
				</div>
				<DialogFooter>
					<Button variant="ghost" size="sm" onClick={handleDismiss}>
						Skip
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
