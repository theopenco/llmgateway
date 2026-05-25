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
	const [scriptLoaded, setScriptLoaded] = useState(
		typeof window !== "undefined" && Boolean(window.Calendly),
	);

	useEffect(() => {
		const container = containerRef.current;
		if (!scriptLoaded || !container || !window.Calendly) {
			return;
		}
		container.innerHTML = "";
		window.Calendly.initInlineWidget({
			url,
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
			<div
				ref={containerRef}
				className="min-h-[700px] w-full overflow-hidden rounded-xl"
			/>
		</>
	);
}
