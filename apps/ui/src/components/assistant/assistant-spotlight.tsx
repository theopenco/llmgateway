"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
	spotlightStore,
	useSpotlight,
} from "@/components/assistant/assistant-store";

const SPOTLIGHT_MS = 7000;
const PADDING = 6;

/** Rings the control the assistant is pointing at and dims the rest. */
export function AssistantSpotlight() {
	const spotlight = useSpotlight();
	const pathname = usePathname();
	const [rect, setRect] = useState<DOMRect | null>(null);

	useEffect(() => {
		spotlightStore.set(null);
	}, [pathname]);

	useEffect(() => {
		if (!spotlight) {
			setRect(null);
			return;
		}
		let frame = 0;
		const track = () => {
			if (!spotlight.element.isConnected) {
				spotlightStore.set(null);
				return;
			}
			setRect(spotlight.element.getBoundingClientRect());
			frame = requestAnimationFrame(track);
		};
		track();
		const dismiss = () => spotlightStore.set(null);
		const timeout = window.setTimeout(dismiss, SPOTLIGHT_MS);
		window.addEventListener("pointerdown", dismiss, { capture: true });
		window.addEventListener("keydown", dismiss, { capture: true });
		return () => {
			cancelAnimationFrame(frame);
			window.clearTimeout(timeout);
			window.removeEventListener("pointerdown", dismiss, { capture: true });
			window.removeEventListener("keydown", dismiss, { capture: true });
		};
	}, [spotlight]);

	if (!spotlight || !rect) {
		return null;
	}

	const below = rect.top < 72;
	const bleed = PADDING * 2;
	const halfWidth = rect.width / 2;
	return createPortal(
		<div
			data-assistant-root
			data-testid="assistant-spotlight"
			className="pointer-events-none fixed inset-0 z-[45]"
			aria-hidden
		>
			<div
				className="assistant-spotlight absolute rounded-xl"
				style={{
					top: rect.top - PADDING,
					left: rect.left - PADDING,
					width: rect.width + bleed,
					height: rect.height + bleed,
				}}
			/>
			<div
				className="absolute -translate-x-1/2 rounded-full bg-[oklch(0.84_0.19_158)] px-3 py-1 font-mono text-[11px] font-semibold tracking-wide whitespace-nowrap text-black uppercase shadow-lg"
				style={{
					left: Math.min(
						Math.max(rect.left + halfWidth, 90),
						window.innerWidth - 90,
					),
					top: below ? rect.bottom + PADDING + 10 : rect.top - PADDING - 34,
				}}
			>
				Here · {spotlight.label}
			</div>
		</div>,
		document.body,
	);
}
