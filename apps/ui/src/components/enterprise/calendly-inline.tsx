"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

interface CalendlyApi {
	initInlineWidget: (options: {
		url: string;
		parentElement: HTMLElement;
		prefill?: { name?: string; email?: string };
	}) => void;
}

declare global {
	interface Window {
		Calendly?: CalendlyApi;
	}
}

export function CalendlyInline({
	url,
	name,
	email,
}: {
	url: string;
	name?: string;
	email?: string;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const initializedRef = useRef(false);
	const [scriptLoaded, setScriptLoaded] = useState(
		typeof window !== "undefined" && Boolean(window.Calendly),
	);

	useEffect(() => {
		const container = containerRef.current;
		if (
			!scriptLoaded ||
			!container ||
			!window.Calendly ||
			initializedRef.current
		) {
			return;
		}
		// Init exactly once per mount; re-initializing into the same node leaves
		// Calendly stuck on its loading spinner.
		initializedRef.current = true;

		const widgetUrl = new URL(url);
		widgetUrl.searchParams.set("hide_gdpr_banner", "1");
		widgetUrl.searchParams.set("primary_color", "2563eb");
		if (document.documentElement.classList.contains("dark")) {
			widgetUrl.searchParams.set("background_color", "0a0a0a");
			widgetUrl.searchParams.set("text_color", "e4e4e7");
		}

		window.Calendly.initInlineWidget({
			url: widgetUrl.toString(),
			parentElement: container,
			prefill: { name, email },
		});
	}, [scriptLoaded, url, name, email]);

	return (
		<>
			<link
				rel="stylesheet"
				href="https://assets.calendly.com/assets/external/widget.css"
			/>
			<Script
				src="https://assets.calendly.com/assets/external/widget.js"
				strategy="afterInteractive"
				onLoad={() => setScriptLoaded(true)}
			/>
			{/* Calendly injects an iframe with height:100%, so the parent needs an
			    explicit (not just min) height for it to render at full size. */}
			<div
				ref={containerRef}
				className="h-[1040px] w-full overflow-hidden rounded-xl border border-border bg-card sm:h-[720px]"
			/>
			<p className="mt-3 text-center text-sm text-muted-foreground">
				Prefer a new tab?{" "}
				<a
					href={url}
					target="_blank"
					rel="noopener noreferrer"
					className="font-medium text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
				>
					Open the scheduler
				</a>
			</p>
		</>
	);
}
