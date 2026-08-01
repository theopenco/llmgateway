"use client";

import { BookOpen, ChevronLeft, ChevronRight } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";

import {
	buildPassportModel,
	spreadSummary,
} from "@/components/profile/passport/passport-data";
import { MAX_TURNED } from "@/components/profile/passport/passport-shared";
import { Button } from "@/components/ui/button";

import type { ProfileData } from "@/components/profile/ProfileView";

// three.js is heavy; load the scene only on the client, when the section
// actually renders.
const PassportCanvas = dynamic(
	() => import("@/components/profile/passport/PassportBook"),
	{
		ssr: false,
		loading: () => (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
				Fetching passport from the consulate…
			</div>
		),
	},
);

const SPREAD_LABELS = [
	"Cover",
	"Visa",
	"Ports of entry · Carriers",
	"Entry & exit stamps",
	"Endorsements",
];

export function ProfilePassport({ profile }: { profile: ProfileData }) {
	const [turned, setTurned] = useState(0);

	const advance = useCallback((direction: 1 | -1) => {
		setTurned((current) =>
			Math.max(0, Math.min(MAX_TURNED, current + direction)),
		);
	}, []);

	// The canvas pages are invisible to assistive technology; announce each
	// spread's content as it changes.
	const summary = useMemo(
		() => spreadSummary(buildPassportModel(profile), turned),
		[profile, turned],
	);

	return (
		<section aria-label="DevPass passport">
			<div className="mb-3 flex items-center justify-between">
				<h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
					<BookOpen className="h-4 w-4" />
					Passport
				</h2>
				<span className="text-xs text-muted-foreground">
					{SPREAD_LABELS[turned]}
				</span>
			</div>
			<div
				className="relative overflow-hidden rounded-xl border bg-gradient-to-b from-muted/60 to-muted/20"
				role="group"
				aria-roledescription="interactive 3D passport"
				tabIndex={0}
				onKeyDown={(event) => {
					// The nav buttons handle their own Enter/Space; acting here
					// too would advance twice per key press.
					if (
						event.target instanceof HTMLElement &&
						event.target.closest("button")
					) {
						return;
					}
					if (event.key === "ArrowRight" || event.key === "Enter") {
						event.preventDefault();
						advance(1);
					}
					if (event.key === "ArrowLeft") {
						event.preventDefault();
						advance(-1);
					}
				}}
			>
				<p className="sr-only" aria-live="polite">
					{summary}
				</p>
				<div className="h-[420px] sm:h-[480px]">
					<PassportCanvas
						profile={profile}
						turned={turned}
						onAdvance={advance}
					/>
				</div>
				<div className="pointer-events-none absolute inset-x-0 bottom-3 flex items-center justify-center gap-2">
					<Button
						size="sm"
						variant="outline"
						className="pointer-events-auto"
						onClick={() => advance(-1)}
						disabled={turned === 0}
						aria-label="Previous page"
					>
						<ChevronLeft className="h-4 w-4" />
					</Button>
					<span className="pointer-events-auto rounded-md border bg-background/80 px-2.5 py-1 text-xs text-muted-foreground backdrop-blur">
						{turned === 0
							? "Tap the passport to open it"
							: SPREAD_LABELS[turned]}
					</span>
					<Button
						size="sm"
						variant="outline"
						className="pointer-events-auto"
						onClick={() => advance(1)}
						disabled={turned === MAX_TURNED}
						aria-label="Next page"
					>
						<ChevronRight className="h-4 w-4" />
					</Button>
				</div>
			</div>
		</section>
	);
}
