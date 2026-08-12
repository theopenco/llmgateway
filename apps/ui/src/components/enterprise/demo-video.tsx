"use client";

import { Play } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";

const DURATION_LABEL = "6:35";

interface Chapter {
	at: number;
	time: string;
	label: string;
}

const CHAPTERS: Chapter[] = [
	{ at: 0, time: "0:00", label: "Dashboard & live activity" },
	{ at: 60, time: "1:00", label: "Usage by model, key & member" },
	{ at: 82, time: "1:22", label: "API keys & IAM rules" },
	{ at: 132, time: "2:12", label: "Team roles & per-developer budgets" },
	{ at: 158, time: "2:38", label: "Compliance & provider-HQ routing" },
	{ at: 200, time: "3:20", label: "Guardrails & security events" },
	{ at: 240, time: "4:00", label: "SAML SSO with Microsoft Entra" },
];

export function EnterpriseDemoVideo() {
	const videoRef = useRef<HTMLVideoElement>(null);
	const [started, setStarted] = useState(false);
	const [activeAt, setActiveAt] = useState(0);

	function playFrom(at: number) {
		const video = videoRef.current;
		if (!video) {
			return;
		}
		setStarted(true);
		setActiveAt(at);
		// preload="none" means metadata is not there yet on the first click, and
		// seeking before it lands is a no-op. play() is what starts the fetch.
		if (video.readyState === 0) {
			video.addEventListener(
				"loadedmetadata",
				() => {
					video.currentTime = at;
				},
				{ once: true },
			);
		} else {
			video.currentTime = at;
		}
		void video.play();
	}

	function syncActiveChapter() {
		const video = videoRef.current;
		if (!video) {
			return;
		}
		const current = CHAPTERS.reduce(
			(acc, chapter) => (video.currentTime >= chapter.at ? chapter.at : acc),
			0,
		);
		setActiveAt((previous) => (previous === current ? previous : current));
	}

	return (
		<div className="mx-auto mt-16 max-w-5xl">
			<div className="relative">
				<div
					aria-hidden
					className="pointer-events-none absolute inset-x-0 -inset-y-6 -z-10 rounded-[2.5rem] bg-[radial-gradient(60%_60%_at_50%_45%,rgba(59,130,246,0.22),transparent_75%)] blur-2xl"
				/>
				<div className="relative overflow-hidden rounded-2xl border-2 border-border/80 bg-card p-1.5 shadow-[0_0_80px_-20px_rgba(59,130,246,0.35)]">
					<div className="relative aspect-[1592/1000] overflow-hidden rounded-xl bg-muted">
						<video
							ref={videoRef}
							className="h-full w-full"
							controls={started}
							controlsList="nodownload"
							playsInline
							preload="none"
							onPlay={() => setStarted(true)}
							onTimeUpdate={syncActiveChapter}
						>
							{/* H.264/mp4 rather than the VP9 webm used elsewhere in the repo:
							    at matched quality VP9 came out ~50% larger on this screen
							    recording, and mp4 also plays on Safari before iOS 17.4. */}
							<source src="/videos/enterprise-demo.mp4" type="video/mp4" />
							<track
								kind="captions"
								src="/videos/enterprise-demo.vtt"
								srcLang="en"
								label="English"
							/>
						</video>

						{!started && (
							<button
								type="button"
								onClick={() => playFrom(0)}
								aria-label={`Play the enterprise product walkthrough, ${DURATION_LABEL}`}
								className="group absolute inset-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-500"
							>
								<Image
									src="/videos/enterprise-demo-poster.jpg"
									alt="LLM Gateway compliance settings restricting routing by provider headquarters, with 14 allowed and 33 blocked providers"
									fill
									loading="eager"
									sizes="(max-width: 1024px) 100vw, 1024px"
									className="object-cover"
								/>
								<span
									aria-hidden
									className="absolute inset-0 bg-linear-to-b from-black/85 via-black/25 to-black/45 transition-colors duration-300 group-hover:via-black/15"
								/>

								<span
									aria-hidden
									className="absolute inset-0 flex items-center justify-center"
								>
									<span className="relative flex size-20 items-center justify-center rounded-full bg-blue-600 text-white shadow-xl shadow-blue-950/50 transition-transform duration-300 ease-out group-hover:scale-110 group-focus-visible:scale-110">
										<span className="absolute inset-0 rounded-full bg-blue-500/40 motion-safe:animate-ping" />
										<Play className="relative ml-1 size-8 fill-current" />
									</span>
								</span>

								<span
									aria-hidden
									className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4 text-left sm:p-6"
								>
									<span className="flex flex-col">
										<span className="text-xs font-mono uppercase tracking-wider text-blue-300">
											Founder walkthrough
										</span>
										<span className="mt-1 hidden text-sm font-semibold text-white sm:block sm:text-base">
											The whole enterprise product, unedited — no sales call
										</span>
									</span>
									<span className="shrink-0 rounded-full border border-white/25 bg-black/50 px-3 py-1 font-mono text-xs text-white backdrop-blur-sm">
										{DURATION_LABEL}
									</span>
								</span>
							</button>
						)}
					</div>
				</div>
			</div>

			<div className="mt-6">
				<p className="mb-3 text-center text-xs font-mono uppercase tracking-wider text-muted-foreground">
					Jump to
				</p>
				<div className="flex flex-wrap justify-center gap-2">
					{CHAPTERS.map((chapter) => {
						const isActive = started && activeAt === chapter.at;
						return (
							<button
								key={chapter.at}
								type="button"
								onClick={() => playFrom(chapter.at)}
								aria-label={`Play ${chapter.label}, starting at ${chapter.time}`}
								className={`flex items-center gap-2 rounded-full border px-3 py-2.5 text-sm transition-colors sm:py-1.5 ${
									isActive
										? "border-blue-500/60 bg-blue-500/10 text-foreground"
										: "border-border bg-card/50 text-muted-foreground hover:border-blue-500/50 hover:text-foreground"
								}`}
							>
								<span className="font-mono text-xs text-blue-500">
									{chapter.time}
								</span>
								{chapter.label}
							</button>
						);
					})}
				</div>
			</div>
		</div>
	);
}
