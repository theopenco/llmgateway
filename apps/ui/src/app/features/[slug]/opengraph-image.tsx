import { ImageResponse } from "next/og";

import { getFeatureBySlug } from "@/lib/features";

export const size = {
	width: 1200,
	height: 630,
};
export const contentType = "image/png";

// Feature icons as SVGs (inline for ImageResponse compatibility)
const featureIcons: Record<string, () => React.JSX.Element> = {
	"unified-api-interface": () => (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			width={80}
			height={80}
		>
			<path d="M4 17l6-6-6-6" />
			<path d="M12 19h8" />
		</svg>
	),
	"multi-provider-support": () => (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			width={80}
			height={80}
		>
			<rect x="2" y="2" width="8" height="8" rx="2" />
			<rect x="14" y="2" width="8" height="8" rx="2" />
			<rect x="2" y="14" width="8" height="8" rx="2" />
			<rect x="14" y="14" width="8" height="8" rx="2" />
		</svg>
	),
	"performance-monitoring": () => (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			width={80}
			height={80}
		>
			<path d="M3 3v18h18" />
			<path d="M18 17V9" />
			<path d="M13 17V5" />
			<path d="M8 17v-3" />
		</svg>
	),
	"secure-key-management": () => (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			width={80}
			height={80}
		>
			<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
		</svg>
	),
	"self-hosted-or-cloud": () => (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			width={80}
			height={80}
		>
			<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
		</svg>
	),
	"cost-aware-analytics": () => (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			width={80}
			height={80}
		>
			<line x1="12" y1="1" x2="12" y2="23" />
			<path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
		</svg>
	),
	"per-model-provider-breakdown": () => (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			width={80}
			height={80}
		>
			<path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
			<path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
			<ellipse cx="12" cy="5" rx="9" ry="3" />
		</svg>
	),
	"errors-reliability-monitoring": () => (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			width={80}
			height={80}
		>
			<path d="M22 12h-4l-3 9L9 3l-3 9H2" />
		</svg>
	),
	"project-level-usage-explorer": () => (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			width={80}
			height={80}
		>
			<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
			<path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
		</svg>
	),
};

// Default icon for features without a specific icon
const DefaultIcon = () => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
		width={80}
		height={80}
	>
		<polygon points="12 2 2 7 12 12 22 7 12 2" />
		<polyline points="2 17 12 22 22 17" />
		<polyline points="2 12 12 17 22 12" />
	</svg>
);

function getIconForFeature(slug: string) {
	return featureIcons[slug] || DefaultIcon;
}

export default async function FeatureOgImage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const feature = getFeatureBySlug(slug);

	if (!feature) {
		return new ImageResponse(
			(
				<div
					style={{
						width: "100%",
						height: "100%",
						display: "flex",
						background: "#000000",
					}}
				/>
			),
			size,
		);
	}

	const Icon = getIconForFeature(feature.slug);

	return new ImageResponse(
		(
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
					fontFamily:
						"system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
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
					<svg
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 218 232"
						width={48}
						height={48}
					>
						<path
							d="M218 59.4686c0-4.1697-2.351-7.9813-6.071-9.8441L119.973 3.58361s2.926 3.32316 2.926 7.01529V218.833c0 4.081-2.926 7.016-2.926 7.016l15.24-7.468c2.964-2.232 7.187-7.443 7.438-16.006.293-9.976.61-84.847.732-121.0353.487-3.6678 4.096-11.0032 14.63-11.0032 10.535 0 29.262 5.1348 37.309 7.7022 2.439.7336 7.608 4.1812 8.779 12.1036 1.17 7.9223.975 59.0507.731 83.6247 0 2.445.137 7.069 6.653 7.069 6.515 0 6.515-7.069 6.515-7.069V59.4686Z"
							fill="#ffffff"
						/>
						<path
							d="M149.235 86.323c0-5.5921 5.132-9.7668 10.589-8.6132l31.457 6.6495c4.061.8585 6.967 4.4207 6.967 8.5824v81.9253c0 5.868 5.121 9.169 5.121 9.169l-51.9-12.658c-1.311-.32-2.234-1.498-2.234-2.852V86.323ZM99.7535 1.15076c7.2925-3.60996 15.8305 1.71119 15.8305 9.86634V220.983c0 8.155-8.538 13.476-15.8305 9.866L6.11596 184.496C2.37105 182.642 0 178.818 0 174.63v-17.868l49.7128 19.865c4.0474 1.617 8.4447-1.372 8.4449-5.741 0-2.66-1.6975-5.022-4.2142-5.863L0 146.992v-14.305l40.2756 7.708c3.9656.759 7.6405-2.289 7.6405-6.337 0-3.286-2.4628-6.048-5.7195-6.413L0 122.917V108.48l78.5181-3.014c4.1532-.16 7.4381-3.582 7.4383-7.7498 0-4.6256-4.0122-8.2229-8.5964-7.7073L0 98.7098V82.4399l53.447-17.8738c2.3764-.7948 3.9791-3.0254 3.9792-5.5374 0-4.0961-4.0978-6.9185-7.9106-5.4486L0 72.6695V57.3696c.0000304-4.1878 2.37107-8.0125 6.11596-9.8664L99.7535 1.15076Z"
							fill="#ffffff"
						/>
					</svg>
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
						<span style={{ color: "#ffffff", fontWeight: 600 }}>
							LLM Gateway
						</span>
						<span style={{ opacity: 0.6 }}>•</span>
						<span>Features</span>
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
						gap: 40,
					}}
				>
					{/* Feature icon */}
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
							color: "#ffffff",
						}}
					>
						<Icon />
					</div>

					{/* Title and subtitle */}
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							gap: 20,
							maxWidth: 1000,
						}}
					>
						<h1
							style={{
								fontSize: 72,
								fontWeight: 700,
								margin: 0,
								letterSpacing: "-0.03em",
								textAlign: "center",
								lineHeight: 1.1,
							}}
						>
							{feature.title}
						</h1>
						<p
							style={{
								fontSize: 32,
								color: "#9CA3AF",
								margin: 0,
								textAlign: "center",
								lineHeight: 1.4,
							}}
						>
							{feature.subtitle}
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
			</div>
		),
		size,
	);
}
