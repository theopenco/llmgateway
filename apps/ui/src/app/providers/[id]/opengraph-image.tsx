import { ImageResponse } from "next/og";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
} from "@llmgateway/models";
import { getProviderIcon } from "@llmgateway/shared/components";

export const size = {
	width: 1200,
	height: 630,
};

export const contentType = "image/png";

interface ImageProps {
	params: Promise<{ id: string }>;
}

export default async function ProviderOgImage({ params }: ImageProps) {
	try {
		const { id } = await params;
		const decodedId = decodeURIComponent(id);

		const provider = providerDefinitions.find((p) => p.id === decodedId);

		if (!provider || provider.name === "LLM Gateway") {
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
						Provider Not Found
					</div>
				),
				size,
			);
		}

		const ProviderIcon = getProviderIcon(provider.id);

		// Count how many models this provider offers
		const supportedModels = modelDefinitions.filter((model) =>
			model.providers.some((p) => p.providerId === provider.id),
		);
		const totalModels = supportedModels.length;

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
						padding: 56,
						boxSizing: "border-box",
					}}
				>
					{/* Header with logo */}
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							alignItems: "center",
							gap: 20,
						}}
					>
						<svg
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 218 232"
							width={64}
							height={64}
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
								gap: 12,
								fontSize: 32,
								color: "#9CA3AF",
							}}
						>
							<span style={{ color: "#ffffff", fontWeight: 600 }}>
								LLM Gateway
							</span>
							<span style={{ opacity: 0.6 }}>•</span>
							<span>Provider</span>
						</div>
					</div>

					{/* Main content - centered */}
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							justifyContent: "center",
							flex: 1,
							gap: 28,
						}}
					>
						{/* Provider icon */}
						<div
							style={{
								width: 160,
								height: 160,
								borderRadius: 32,
								backgroundColor: "#1a1a1a",
								border: "3px solid rgba(255,255,255,0.15)",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								color: "#ffffff",
							}}
						>
							{ProviderIcon ? (
								<ProviderIcon width={96} height={96} />
							) : (
								<span
									style={{
										fontSize: 72,
										fontWeight: 700,
									}}
								>
									{provider.name.charAt(0).toUpperCase()}
								</span>
							)}
						</div>

						{/* Provider name and info */}
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
									fontSize: 96,
									fontWeight: 700,
									margin: 0,
									letterSpacing: "-0.03em",
									textAlign: "center",
									lineHeight: 1.1,
								}}
							>
								{provider.name}
							</h1>

							{/* Model count badge */}
							<div
								style={{
									display: "flex",
									flexDirection: "row",
									alignItems: "center",
									gap: 12,
									backgroundColor: "#1a1a1a",
									border: "2px solid rgba(255,255,255,0.15)",
									borderRadius: 999,
									padding: "16px 36px",
								}}
							>
								<span
									style={{
										fontSize: 40,
										fontWeight: 700,
										fontVariantNumeric: "tabular-nums",
									}}
								>
									{totalModels}
								</span>
								<span
									style={{
										fontSize: 36,
										color: "#9CA3AF",
									}}
								>
									{totalModels === 1 ? "model" : "models"} available
								</span>
							</div>
						</div>
					</div>

					{/* Footer */}
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							justifyContent: "space-between",
							alignItems: "center",
							fontSize: 28,
							color: "#9CA3AF",
						}}
					>
						<span style={{ opacity: 0.6 }}>{provider.id}</span>
						<span>llmgateway.io</span>
					</div>
				</div>
			),
			size,
		);
	} catch {
		// Fallback image in case of errors
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
						fontSize: 40,
						fontWeight: 700,
						fontFamily:
							"system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
					}}
				>
					LLM Gateway Provider
				</div>
			),
			size,
		);
	}
}
