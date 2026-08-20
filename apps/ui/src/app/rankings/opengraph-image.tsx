import { ImageResponse } from "next/og";

import Logo from "@/lib/icons/Logo";

export const size = {
	width: 1200,
	height: 630,
};

export const contentType = "image/png";

export const alt = "LLM Rankings — Top Models by Real Usage";

// Illustrative stacked-bar motif echoing the live rankings chart; the palette
// matches SERIES_PALETTE (dark) in rankings-content.tsx.
const BAR_COLORS = [
	"#0284c7",
	"#8b5cf6",
	"#0d9488",
	"#d97706",
	"#ec4899",
	"#6366f1",
];

// Per-column segment heights (px), bottom segment first.
const BARS: number[][] = [
	[52, 26, 18, 12, 8, 6],
	[64, 30, 22, 14, 10, 6],
	[58, 34, 20, 16, 8, 8],
	[76, 38, 26, 16, 12, 8],
	[88, 42, 28, 20, 12, 10],
	[82, 48, 30, 18, 14, 10],
	[104, 52, 34, 22, 16, 12],
	[122, 58, 38, 26, 18, 12],
];

export default function RankingsOgImage() {
	return new ImageResponse(
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
				fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
				padding: 72,
				boxSizing: "border-box",
			}}
		>
			{/* Header */}
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					alignItems: "center",
					gap: 14,
				}}
			>
				<div style={{ display: "flex", color: "#ffffff" }}>
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
					<span style={{ color: "#ffffff", fontWeight: 600 }}>LLM Gateway</span>
					<span style={{ color: "#4B5563" }}>/</span>
					<span style={{ color: "#9CA3AF" }}>Rankings</span>
				</div>
			</div>

			{/* Title + stacked-bar motif */}
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					alignItems: "flex-end",
					justifyContent: "space-between",
					gap: 48,
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 24,
						maxWidth: 640,
					}}
				>
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							alignItems: "center",
							gap: 10,
							fontSize: 22,
							color: "#4ade80",
						}}
					>
						<div
							style={{
								display: "flex",
								width: 10,
								height: 10,
								borderRadius: 999,
								background: "#4ade80",
							}}
						/>
						<span>Live gateway traffic</span>
					</div>
					<h1
						style={{
							fontSize: 84,
							fontWeight: 800,
							letterSpacing: "-0.03em",
							lineHeight: 1.02,
							margin: 0,
						}}
					>
						LLM Rankings
					</h1>
					<p
						style={{
							fontSize: 30,
							lineHeight: 1.35,
							margin: 0,
							color: "#9CA3AF",
						}}
					>
						Top models by real token volume routed through LLM Gateway — not
						benchmarks, not vibes.
					</p>
				</div>

				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "flex-end",
						gap: 14,
					}}
				>
					{BARS.map((segments, columnIndex) => (
						<div
							key={columnIndex}
							style={{
								display: "flex",
								flexDirection: "column-reverse",
								gap: 3,
								width: 34,
							}}
						>
							{segments.map((height, segmentIndex) => (
								<div
									key={segmentIndex}
									style={{
										display: "flex",
										height,
										width: "100%",
										borderRadius: 2,
										background: BAR_COLORS[segmentIndex],
										opacity: segmentIndex === 0 ? 1 : 0.85,
									}}
								/>
							))}
						</div>
					))}
				</div>
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
					llmgateway.io/rankings
				</span>
				<span>Updated every few minutes</span>
			</div>
		</div>,
		size,
	);
}
