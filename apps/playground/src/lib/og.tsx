import { ImageResponse } from "next/og";

import {
	LgMark,
	OG_BACKGROUND,
	OG_CONTENT_TYPE,
	OG_GRADIENT,
	OG_SIZE,
	Pill,
} from "@/components/compare/og-shared";
import { BRAND } from "@/lib/brand";

export const ogSize = OG_SIZE;
export const ogContentType = OG_CONTENT_TYPE;

interface LoungeOgOptions {
	eyebrow: string;
	title: string;
	subtitle: string;
	path: string;
}

/**
 * Shared Lounge OpenGraph card so every studio and marketing page ships a
 * branded 1200x630 image. Inline styles only — rendered by next/og (Satori).
 */
export function loungeOgImage({
	eyebrow,
	title,
	subtitle,
	path,
}: LoungeOgOptions) {
	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				background: OG_BACKGROUND,
				backgroundImage: OG_GRADIENT,
				color: "white",
				fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
				padding: 64,
				boxSizing: "border-box",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					width: "100%",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 16 }}>
					<LgMark size={44} />
					<div style={{ display: "flex", flexDirection: "column" }}>
						<span style={{ fontSize: 26, fontWeight: 700 }}>{BRAND.name}</span>
						<span
							style={{
								fontSize: 16,
								color: "#A1A1AA",
								letterSpacing: "0.02em",
							}}
						>
							by {BRAND.publisher}
						</span>
					</div>
				</div>
				<Pill>{eyebrow}</Pill>
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
				<span
					style={{
						display: "flex",
						fontSize: 70,
						fontWeight: 800,
						lineHeight: 1.05,
						letterSpacing: "-0.02em",
						color: "#FAFAFA",
						maxWidth: 1010,
					}}
				>
					{title}
				</span>
				<span
					style={{
						display: "flex",
						fontSize: 28,
						lineHeight: 1.3,
						color: "#A1A1AA",
						maxWidth: 960,
					}}
				>
					{subtitle}
				</span>
			</div>

			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					fontSize: 20,
					color: "#A1A1AA",
				}}
			>
				<span style={{ color: "#FAFAFA", fontWeight: 600 }}>
					lounge.llmgateway.io{path}
				</span>
				<span>{BRAND.tagline}</span>
			</div>
		</div>,
		ogSize,
	);
}
