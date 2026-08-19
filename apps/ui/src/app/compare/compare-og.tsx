import { ImageResponse } from "next/og";

import { LLMGatewayOgIcon } from "./og-icons";

import type { CompareOgIconProps } from "./og-icons";

export const compareOgSize = {
	width: 1200,
	height: 630,
};

export const compareOgContentType = "image/png";

interface CompareOgImageOptions {
	/** Competitor name as it should read in the headline. */
	competitor: string;
	/** One line on why someone would switch. Keep it under ~90 characters. */
	subtitle: string;
	Icon: (props: CompareOgIconProps) => React.JSX.Element;
	/** Overrides the mark size for wordmarks that are not square. */
	iconSize?: number;
}

/**
 * Shared "LLM Gateway vs X" card behind every /compare page, so the seven
 * comparisons stay visually identical and a new competitor only needs a mark
 * and a subtitle.
 */
export function compareOgImage({
	competitor,
	subtitle,
	Icon,
	iconSize,
}: CompareOgImageOptions) {
	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				alignItems: "stretch",
				background: "#000000",
				color: "white",
				fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
				padding: 60,
				boxSizing: "border-box",
			}}
		>
			{/* Header with logo */}
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					alignItems: "center",
					gap: 16,
				}}
			>
				<LLMGatewayOgIcon size={48} />
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						gap: 8,
						fontSize: 24,
						color: "#9CA3AF",
					}}
				>
					<span style={{ color: "#ffffff", fontWeight: 600 }}>LLM Gateway</span>
					<span style={{ opacity: 0.6 }}>•</span>
					<span>Comparison</span>
				</div>
			</div>

			{/* Main content */}
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					flex: 1,
					gap: 48,
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						gap: 32,
					}}
				>
					<div
						style={{
							width: 120,
							height: 120,
							borderRadius: 20,
							backgroundColor: "#1a1a1a",
							border: "2px solid rgba(59,130,246,0.5)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							padding: 16,
						}}
					>
						<LLMGatewayOgIcon size={80} />
					</div>

					<span
						style={{
							fontSize: 40,
							fontWeight: 700,
							color: "#9CA3AF",
							letterSpacing: "0.05em",
						}}
					>
						VS
					</span>

					<div
						style={{
							width: 120,
							height: 120,
							borderRadius: 20,
							backgroundColor: "#1a1a1a",
							border: "2px solid rgba(255,255,255,0.1)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							padding: 16,
						}}
					>
						<Icon size={iconSize} />
					</div>
				</div>

				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						gap: 24,
						maxWidth: 1000,
					}}
				>
					<h1
						style={{
							fontSize: 64,
							fontWeight: 700,
							margin: 0,
							letterSpacing: "-0.03em",
							textAlign: "center",
							lineHeight: 1.1,
						}}
					>
						LLM Gateway vs {competitor}
					</h1>
					<p
						style={{
							fontSize: 28,
							color: "#9CA3AF",
							margin: 0,
							textAlign: "center",
							lineHeight: 1.3,
						}}
					>
						{subtitle}
					</p>
				</div>
			</div>

			{/* Footer */}
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					justifyContent: "flex-end",
					fontSize: 20,
					color: "#9CA3AF",
				}}
			>
				<span>llmgateway.io</span>
			</div>
		</div>,
		compareOgSize,
	);
}
