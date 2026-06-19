import { ImageResponse } from "next/og";

import Logo from "@/lib/icons/Logo";

export const ogSize = {
	width: 1200,
	height: 630,
};

export const ogContentType = "image/png";

interface OgImageOptions {
	eyebrow: string;
	title: string;
	subtitle: string;
}

/**
 * Shared OpenGraph image template so every marketing page renders a
 * consistent, on-brand 1200x630 card with the LLM Gateway logo in the
 * top-left corner and a faint logo watermark in the opposite corner.
 */
export function ogImage({ eyebrow, title, subtitle }: OgImageOptions) {
	return new ImageResponse(
		(
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					flexDirection: "column",
					justifyContent: "space-between",
					position: "relative",
					background: "#000000",
					backgroundImage:
						"radial-gradient(1100px 620px at 82% -12%, rgba(56,189,248,0.22), transparent 60%), radial-gradient(900px 620px at -8% 112%, rgba(139,92,246,0.20), transparent 55%)",
					color: "#ffffff",
					fontFamily:
						"system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
					padding: 72,
					boxSizing: "border-box",
				}}
			>
				{/* Faint logo watermark in the bottom-right corner */}
				<div
					style={{
						position: "absolute",
						right: -70,
						bottom: -90,
						display: "flex",
						color: "#ffffff",
						opacity: 0.04,
					}}
				>
					<Logo style={{ width: 440, height: 440 }} />
				</div>

				{/* Header: logo in the top-left corner + wordmark + eyebrow */}
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						gap: 14,
					}}
				>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							color: "#ffffff",
						}}
					>
						<Logo style={{ width: 44, height: 44 }} />
					</div>
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							alignItems: "center",
							gap: 10,
							fontSize: 24,
						}}
					>
						<span style={{ color: "#ffffff", fontWeight: 600 }}>
							LLM Gateway
						</span>
						<span style={{ color: "#4B5563" }}>/</span>
						<span style={{ color: "#9CA3AF" }}>{eyebrow}</span>
					</div>
				</div>

				{/* Main: title + subtitle */}
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 24,
						maxWidth: 940,
					}}
				>
					<h1
						style={{
							fontSize: 78,
							fontWeight: 800,
							letterSpacing: "-0.03em",
							lineHeight: 1.05,
							margin: 0,
							color: "#ffffff",
						}}
					>
						{title}
					</h1>
					<p
						style={{
							fontSize: 30,
							lineHeight: 1.35,
							margin: 0,
							maxWidth: 840,
							color: "#9CA3AF",
						}}
					>
						{subtitle}
					</p>
				</div>

				{/* Footer */}
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						justifyContent: "space-between",
						fontSize: 22,
						color: "#9CA3AF",
					}}
				>
					<span style={{ color: "#ffffff", fontWeight: 600 }}>
						llmgateway.io
					</span>
					<span>One API. Every model.</span>
				</div>
			</div>
		),
		ogSize,
	);
}
