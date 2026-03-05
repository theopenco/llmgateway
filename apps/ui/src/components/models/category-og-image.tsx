import { ImageResponse } from "next/og";

import {
	models as modelDefinitions,
	type ModelDefinition,
	type ProviderModelMapping,
} from "@llmgateway/models";

export const ogSize = {
	width: 1200,
	height: 630,
};
export const ogContentType = "image/png";

interface CategoryOgConfig {
	title: string;
	subtitle: string;
	accentColor: string;
	accentColorDim: string;
	iconSvgPath: string;
	countFilter: (model: ModelDefinition) => boolean;
}

export const categoryConfigs: Record<string, CategoryOgConfig> = {
	text: {
		title: "Text Generation",
		subtitle: "Chat, code, and content creation models",
		accentColor: "#3B82F6",
		accentColorDim: "#1E3A5F",
		// Lucide "Type" icon path
		iconSvgPath: "M4 7V4h16v3 M9 20h6 M12 4v16",
		countFilter: (m) => !m.output?.includes("image"),
	},
	"text-to-image": {
		title: "Text to Image",
		subtitle: "Generate images from text prompts",
		accentColor: "#EC4899",
		accentColorDim: "#701A3E",
		// Lucide "ImagePlus" icon path
		iconSvgPath:
			"M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7 M16 5h6 M19 2v6 M21 15l-5-5L5 21",
		countFilter: (m) => m.output?.includes("image") === true,
	},
	"image-to-image": {
		title: "Image to Image",
		subtitle: "Edit and transform images with AI",
		accentColor: "#A855F7",
		accentColorDim: "#4C1D95",
		// Lucide "Repeat2" / arrows icon path
		iconSvgPath:
			"M17 1l4 4-4 4 M3 11V9a4 4 0 0 1 4-4h14 M7 23l-4-4 4-4 M21 13v2a4 4 0 0 1-4 4H3",
		countFilter: (m) =>
			m.output?.includes("image") === true &&
			m.providers.some((p) => (p as ProviderModelMapping).vision),
	},
	"web-search": {
		title: "Web Search",
		subtitle: "Real-time internet-grounded responses",
		accentColor: "#0EA5E9",
		accentColorDim: "#0C4A6E",
		// Lucide "Globe" icon path
		iconSvgPath:
			"M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z",
		countFilter: (m) =>
			m.providers.some((p) => (p as ProviderModelMapping).webSearch),
	},
	vision: {
		title: "Vision",
		subtitle: "Analyze and understand images",
		accentColor: "#22C55E",
		accentColorDim: "#14532D",
		// Lucide "Eye" icon path
		iconSvgPath:
			"M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
		countFilter: (m) =>
			m.providers.some((p) => (p as ProviderModelMapping).vision),
	},
	reasoning: {
		title: "Reasoning",
		subtitle: "Advanced chain-of-thought problem solving",
		accentColor: "#F97316",
		accentColorDim: "#7C2D12",
		// Lucide "Brain" icon path
		iconSvgPath:
			"M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z M12 5v13",
		countFilter: (m) =>
			m.providers.some((p) => (p as ProviderModelMapping).reasoning),
	},
	tools: {
		title: "Tool Calling",
		subtitle: "Function calling for agentic applications",
		accentColor: "#8B5CF6",
		accentColorDim: "#3B0764",
		// Lucide "Wrench" icon path
		iconSvgPath:
			"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z",
		countFilter: (m) =>
			m.providers.some((p) => (p as ProviderModelMapping).tools),
	},
	discounted: {
		title: "Discounted",
		subtitle: "Models with active pricing discounts",
		accentColor: "#EF4444",
		accentColorDim: "#7F1D1D",
		// Lucide "Percent" icon path
		iconSvgPath:
			"M19 5L5 19 M9 6.5a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z M20 17.5a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z",
		countFilter: (m) => {
			const providers = m.providers as ProviderModelMapping[];
			return providers.some((p) => p.discount && p.discount > 0);
		},
	},
};

export function generateCategoryOgImage(categoryKey: string) {
	const config = categoryConfigs[categoryKey];
	if (!config) {
		return new ImageResponse(
			(
				<div
					style={{
						width: "100%",
						height: "100%",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						background: "#000000",
						color: "white",
						fontSize: 48,
						fontWeight: 700,
						fontFamily:
							"system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
					}}
				>
					LLM Gateway
				</div>
			),
			ogSize,
		);
	}

	const modelCount = modelDefinitions.filter(config.countFilter).length;

	return new ImageResponse(
		(
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					flexDirection: "row",
					background: "#000000",
					color: "white",
					fontFamily:
						"system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
					overflow: "hidden",
				}}
			>
				{/* Left accent stripe */}
				<div
					style={{
						width: 8,
						height: "100%",
						backgroundColor: config.accentColor,
						display: "flex",
					}}
				/>

				{/* Main content area */}
				<div
					style={{
						flex: 1,
						display: "flex",
						flexDirection: "column",
						justifyContent: "space-between",
						padding: "56px 56px 56px 48px",
					}}
				>
					{/* Top: Logo bar */}
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							alignItems: "center",
							justifyContent: "space-between",
						}}
					>
						<div
							style={{
								display: "flex",
								flexDirection: "row",
								alignItems: "center",
								gap: 14,
							}}
						>
							<svg
								fill="none"
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 218 232"
								width={36}
								height={36}
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
							<span
								style={{
									fontSize: 22,
									fontWeight: 600,
									color: "#9CA3AF",
									letterSpacing: "0.02em",
								}}
							>
								LLM Gateway
							</span>
						</div>

						<span
							style={{
								fontSize: 18,
								color: "#6B7280",
								letterSpacing: "0.05em",
							}}
						>
							llmgateway.io
						</span>
					</div>

					{/* Middle: Main content */}
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: 32,
						}}
					>
						{/* Category icon + label */}
						<div
							style={{
								display: "flex",
								flexDirection: "row",
								alignItems: "center",
								gap: 16,
							}}
						>
							<div
								style={{
									width: 56,
									height: 56,
									borderRadius: 14,
									backgroundColor: config.accentColorDim,
									border: `2px solid ${config.accentColor}`,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
								}}
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width={28}
									height={28}
									viewBox="0 0 24 24"
									fill="none"
									stroke={config.accentColor}
									strokeWidth={2}
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<path d={config.iconSvgPath} />
								</svg>
							</div>
							<span
								style={{
									fontSize: 20,
									fontWeight: 600,
									color: config.accentColor,
									textTransform: "uppercase",
									letterSpacing: "0.12em",
								}}
							>
								Models
							</span>
						</div>

						{/* Title */}
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: 16,
							}}
						>
							<h1
								style={{
									fontSize: 82,
									fontWeight: 700,
									margin: 0,
									letterSpacing: "-0.03em",
									lineHeight: 1,
									color: "#ffffff",
								}}
							>
								{config.title}
							</h1>
							<p
								style={{
									fontSize: 28,
									margin: 0,
									color: "#9CA3AF",
									lineHeight: 1.3,
								}}
							>
								{config.subtitle}
							</p>
						</div>
					</div>

					{/* Bottom: Model count */}
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							alignItems: "center",
							gap: 16,
						}}
					>
						<div
							style={{
								display: "flex",
								flexDirection: "row",
								alignItems: "baseline",
								gap: 10,
								backgroundColor: "#0A0A0A",
								border: "1px solid #1F2937",
								borderRadius: 12,
								padding: "12px 24px",
							}}
						>
							<span
								style={{
									fontSize: 36,
									fontWeight: 700,
									color: config.accentColor,
									fontVariantNumeric: "tabular-nums",
								}}
							>
								{modelCount}
							</span>
							<span
								style={{
									fontSize: 20,
									color: "#6B7280",
									fontWeight: 500,
								}}
							>
								{modelCount === 1 ? "model" : "models"} available
							</span>
						</div>
					</div>
				</div>

				{/* Right: Large decorative icon */}
				<div
					style={{
						width: 300,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						opacity: 0.06,
					}}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width={240}
						height={240}
						viewBox="0 0 24 24"
						fill="none"
						stroke={config.accentColor}
						strokeWidth={1}
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d={config.iconSvgPath} />
					</svg>
				</div>
			</div>
		),
		ogSize,
	);
}
