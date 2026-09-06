"use client";

import { useEffect, useRef, useState } from "react";

import { Logo } from "@/components/ui/logo";

import { JellyControls } from "./jelly-controls";
import { createJellyScene } from "./jelly-scene";
import { defaultJellySettings } from "./jelly-settings";

export function JellyLogo() {
	const canvas = useRef<HTMLCanvasElement>(null);
	const scene = useRef<ReturnType<typeof createJellyScene> | null>(null);
	const [ready, setReady] = useState(false);
	const [reduced, setReduced] = useState(false);
	const [settings, setSettings] = useState(defaultJellySettings);
	const interactive = ready && !reduced && !settings.paused;
	const controls = (
		<JellyControls
			value={settings}
			disabled={!ready}
			reduced={reduced}
			onChange={setSettings}
			onNudge={() => scene.current?.bounce()}
			onReset={() => scene.current?.reset()}
		/>
	);

	useEffect(() => {
		if (!canvas.current) {
			return;
		}
		const element = canvas.current;
		let mounted = true;
		let jelly: ReturnType<typeof createJellyScene>;
		try {
			jelly = createJellyScene(element);
		} catch (error) {
			// WebGL is optional; the static logo keeps the error page usable.
			// eslint-disable-next-line no-console
			console.warn("Could not initialize the 404 jelly", error);
			return;
		}
		scene.current = jelly;
		const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
		const updateMotion = () => {
			jelly.setReducedMotion(motion.matches);
			setReduced(motion.matches);
		};
		const updateTheme = () => {
			jelly.setTheme(document.documentElement.classList.contains("dark"));
		};
		const theme = new MutationObserver(updateTheme);
		theme.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class"],
		});
		motion.addEventListener("change", updateMotion);
		updateMotion();
		updateTheme();
		void jelly.ready
			.then(() => {
				if (mounted && scene.current === jelly) {
					setReady(true);
				}
			})
			.catch((error: unknown) => {
				// eslint-disable-next-line no-console
				console.warn("Could not load the 404 jelly studio", error);
				jelly.dispose();
				if (scene.current === jelly) {
					scene.current = null;
				}
			});
		const contextLost = (event: Event) => {
			event.preventDefault();
			jelly.dispose();
			scene.current = null;
			setReady(false);
		};
		element.addEventListener("webglcontextlost", contextLost);
		return () => {
			mounted = false;
			theme.disconnect();
			motion.removeEventListener("change", updateMotion);
			element.removeEventListener("webglcontextlost", contextLost);
			jelly.dispose();
			scene.current = null;
		};
	}, []);

	useEffect(() => {
		scene.current?.setSettings(settings);
	}, [settings]);

	return (
		<div className="mx-auto grid w-full items-center gap-4 lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-8">
			<div>
				<div className="relative aspect-square rounded-3xl has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring sm:aspect-[4/3]">
					{!ready && (
						<div
							aria-hidden="true"
							className="absolute inset-0 flex items-center justify-center"
						>
							<span className="absolute font-sans text-[clamp(140px,29vw,280px)] font-semibold tracking-tighter text-foreground/5">
								404
							</span>
							<Logo className="relative w-[30%] text-foreground/30" />
						</div>
					)}
					<canvas
						ref={canvas}
						className="absolute inset-0 h-full w-full outline-none"
						style={{
							opacity: ready ? 1 : 0,
							touchAction: interactive ? "none" : "pan-y",
							maskImage:
								"radial-gradient(ellipse closest-side at 50% 48%, black 60%, transparent 100%)",
						}}
						role={interactive ? "button" : "img"}
						tabIndex={interactive ? 0 : undefined}
						aria-label={
							interactive
								? "Squish the jelly LLM Gateway logo"
								: "LLM Gateway logo"
						}
						aria-describedby={interactive ? "jelly-hint" : undefined}
						onKeyDown={(event) => {
							if (interactive && (event.key === "Enter" || event.key === " ")) {
								event.preventDefault();
								scene.current?.bounce();
							}
						}}
					/>
				</div>
				<p
					id="jelly-hint"
					className="h-5 text-center text-xs text-muted-foreground"
					style={{ visibility: ready && !reduced ? "visible" : "hidden" }}
				>
					{settings.paused
						? "Paused. Resume to keep playing."
						: "Drag to stretch. Click or press Enter to squish."}
				</p>
			</div>
			<div className="hidden lg:block">{controls}</div>
			<details className="group w-full lg:hidden">
				<summary className="mx-auto flex min-h-11 w-fit cursor-pointer list-none items-center gap-3 rounded-full border border-border px-5 text-xs text-muted-foreground outline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
					Jelly controls
					<span aria-hidden="true" className="text-base group-open:rotate-45">
						+
					</span>
				</summary>
				<div className="mt-4">{controls}</div>
			</details>
		</div>
	);
}
