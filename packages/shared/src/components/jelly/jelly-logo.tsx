"use client";

import { useEffect, useRef, useState } from "react";

import { Logo } from "@/components/ui/logo";

import { createJellyScene } from "./jelly-scene";

export function JellyLogo() {
	const canvas = useRef<HTMLCanvasElement>(null);
	const scene = useRef<ReturnType<typeof createJellyScene> | null>(null);
	const [ready, setReady] = useState(false);
	const [reduced, setReduced] = useState(false);
	const interactive = ready && !reduced;

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

	return (
		<div className="mx-auto w-full max-w-[760px]">
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
							"linear-gradient(to bottom, black 80%, transparent 100%)",
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
				Drag to stretch. Click or press Enter to squish.
			</p>
		</div>
	);
}
