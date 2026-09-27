"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import { usePostHog } from "posthog-js/react";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

export interface Slide {
	slug: string;
	label: string;
	alt: string;
}

export function ProductSlider({
	product,
	slides,
	width,
	height,
	sizes,
	activeTone,
	frameClassName,
}: {
	product: string;
	slides: Slide[];
	width: number;
	height: number;
	sizes: string;
	activeTone: string;
	frameClassName?: string;
}) {
	const posthog = usePostHog();
	const trackRef = useRef<HTMLDivElement>(null);
	const [active, setActive] = useState(0);

	const goTo = (index: number) => {
		const track = trackRef.current;
		const next = (index + slides.length) % slides.length;
		if (track) {
			track.scrollTo({ left: next * track.clientWidth, behavior: "smooth" });
		}
		setActive(next);
		posthog.capture("home_product_slide_viewed", {
			product,
			slide: slides[next].slug,
		});
	};

	const onScroll = () => {
		const track = trackRef.current;
		if (!track) {
			return;
		}
		const index = Math.round(track.scrollLeft / track.clientWidth);
		if (index !== active && index >= 0 && index < slides.length) {
			setActive(index);
		}
	};

	return (
		<div className="relative z-10">
			<div className="mb-3 flex items-center gap-2">
				<div
					role="tablist"
					aria-label="Screens"
					className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none]"
				>
					{slides.map((slide, i) => (
						<button
							key={slide.slug}
							type="button"
							role="tab"
							aria-selected={i === active}
							onClick={() => goTo(i)}
							className={cn(
								"shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
								i === active
									? activeTone
									: "border-border bg-background/70 text-muted-foreground hover:text-foreground",
							)}
						>
							{slide.label}
						</button>
					))}
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<span className="mr-1 font-mono text-[11px] tabular-nums text-muted-foreground">
						{active + 1}/{slides.length}
					</span>
					<button
						type="button"
						aria-label="Previous screen"
						onClick={() => goTo(active - 1)}
						className="flex size-7 items-center justify-center rounded-full border border-border bg-background/70 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<ChevronLeft className="size-4" />
					</button>
					<button
						type="button"
						aria-label="Next screen"
						onClick={() => goTo(active + 1)}
						className="flex size-7 items-center justify-center rounded-full border border-border bg-background/70 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<ChevronRight className="size-4" />
					</button>
				</div>
			</div>

			<div
				className={cn(
					"relative overflow-hidden rounded-t-xl border border-b-0 border-border bg-background shadow-[0_24px_60px_-30px_rgba(0,0,0,0.45)]",
					frameClassName,
				)}
			>
				<div
					ref={trackRef}
					onScroll={onScroll}
					tabIndex={0}
					aria-label={`${slides[active].label} screen`}
					className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] focus-visible:outline-none"
				>
					{slides.map((slide) => (
						<div
							key={slide.slug}
							className="w-full shrink-0 snap-center"
							aria-hidden={slide.slug !== slides[active].slug}
						>
							<Image
								src={`/home/products/${product}-${slide.slug}-light.webp`}
								alt={slide.alt}
								width={width}
								height={height}
								sizes={sizes}
								className="block h-auto w-full dark:hidden"
							/>
							<Image
								src={`/home/products/${product}-${slide.slug}-dark.webp`}
								alt={slide.alt}
								width={width}
								height={height}
								sizes={sizes}
								className="hidden h-auto w-full dark:block"
							/>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
