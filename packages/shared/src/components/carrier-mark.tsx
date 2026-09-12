"use client";

import type { CSSProperties } from "react";

// Colors that don't disqualify an SVG from the monochrome treatment.
const NEUTRAL_COLORS = new Set([
	"none",
	"currentcolor",
	"transparent",
	"inherit",
	"#fff",
	"#ffffff",
	"white",
	"#000",
	"#000000",
	"black",
]);

const COLOR_ATTR_PATTERN =
	/(?:fill|stroke|stop-color)\s*[=:]\s*["']?([^"';)]+)/gi;

/**
 * True when every fill/stroke in the SVG data URL is black, white or neutral —
 * i.e. a single-color mark that can be recolored with currentColor. Colorful
 * brand logos return false and keep their own palette.
 */
export function isMonochromeSvgDataUrl(dataUrl: string): boolean {
	const prefix = "data:image/svg+xml;base64,";
	if (!dataUrl.startsWith(prefix)) {
		return false;
	}
	let svg: string;
	try {
		svg = atob(dataUrl.slice(prefix.length));
	} catch {
		return false;
	}
	// Raster-wrapping SVGs (<image href=...>) have no paint attributes and
	// would mask into a flat silhouette — treat them as colorful.
	if (/<image[\s>]/i.test(svg)) {
		return false;
	}
	let match: RegExpExecArray | null;
	COLOR_ATTR_PATTERN.lastIndex = 0;
	while ((match = COLOR_ATTR_PATTERN.exec(svg)) !== null) {
		const value = match[1].trim().toLowerCase();
		if (value.startsWith("url(")) {
			// Gradient/pattern references — treat as colorful.
			return false;
		}
		if (!NEUTRAL_COLORS.has(value)) {
			return false;
		}
	}
	return true;
}

/**
 * Renders a carrier-uploaded SVG mark. Monochrome marks are painted with
 * `currentColor` through a CSS mask, so they follow the surrounding text color
 * in light and dark mode (an SVG inside `<img>` can never inherit it, and
 * inlining user-uploaded SVG markup would be an XSS vector). Colorful logos
 * render as a plain image with their own palette.
 */
export function CarrierMark({
	src,
	alt = "",
	className,
}: {
	src: string;
	alt?: string;
	className?: string;
}) {
	if (isMonochromeSvgDataUrl(src)) {
		const maskStyle: CSSProperties = {
			backgroundColor: "currentColor",
			maskImage: `url("${src}")`,
			WebkitMaskImage: `url("${src}")`,
			maskRepeat: "no-repeat",
			WebkitMaskRepeat: "no-repeat",
			maskPosition: "center",
			WebkitMaskPosition: "center",
			maskSize: "contain",
			WebkitMaskSize: "contain",
		};
		return (
			<span
				role="img"
				aria-label={alt}
				className={className}
				style={{ display: "inline-block", ...maskStyle }}
			/>
		);
	}
	return <img src={src} alt={alt} className={className} />;
}
