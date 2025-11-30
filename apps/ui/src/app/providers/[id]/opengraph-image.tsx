import { ImageResponse } from "next/og";

import { getProviderIcon } from "@/lib/components/providers-icons";
import Logo from "@/lib/icons/Logo";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
} from "@llmgateway/models";

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
							background: "#020817",
							color: "white",
							fontSize: 48,
							fontWeight: 700,
							fontFamily:
								"system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
						}}
					>
						Provider not found
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

		const hasStreaming = !!provider.streaming;
		const hasCancellation = !!provider.cancellation;

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
						padding: 48,
						boxSizing: "border-box",
						gap: 24,
					}}
				>
					{/* Header */}
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "flex-start",
							gap: 12,
						}}
					>
						<div
							style={{
								display: "flex",
								flexDirection: "row",
								alignItems: "center",
								gap: 10,
							}}
						>
							<div
								style={{
									width: 24,
									height: 24,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									color: "#ffffff",
								}}
							>
								<Logo style={{ width: 20, height: 20 }} />
							</div>
							<div
								style={{
									display: "flex",
									flexDirection: "row",
									alignItems: "center",
									gap: 6,
									fontSize: 16,
									color: "#9CA3AF",
								}}
							>
								<span>LLM Gateway</span>
								<span style={{ opacity: 0.6 }}>•</span>
								<span>Provider</span>
							</div>
						</div>

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
									width: 56,
									height: 56,
									borderRadius: 999,
									backgroundColor: "#020617",
									border: "1px solid rgba(148,163,184,0.4)",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									overflow: "hidden",
								}}
							>
								{ProviderIcon ? (
									<ProviderIcon width={32} height={32} />
								) : (
									<span
										style={{
											fontSize: 22,
											fontWeight: 700,
										}}
									>
										{provider.name.charAt(0).toUpperCase()}
									</span>
								)}
							</div>
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									gap: 4,
								}}
							>
								<span
									style={{
										fontSize: 28,
										fontWeight: 600,
									}}
								>
									{provider.name}
								</span>
								{provider.website && (
									<span
										style={{
											fontSize: 16,
											color: "#9CA3AF",
										}}
									>
										{new URL(provider.website).hostname}
									</span>
								)}
							</div>
						</div>

						{provider.description && (
							<div
								style={{
									display: "flex",
									fontSize: 18,
									color: "#D1D5DB",
									lineHeight: 1.4,
									maxWidth: 820,
								}}
							>
								{provider.description}
							</div>
						)}
					</div>

					{/* Stats & capabilities */}
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							justifyContent: "space-between",
							alignItems: "flex-start",
							gap: 40,
						}}
					>
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: 10,
								fontSize: 16,
							}}
						>
							<span
								style={{
									color: "#9CA3AF",
									fontSize: 14,
									textTransform: "uppercase",
									letterSpacing: 1,
								}}
							>
								Overview
							</span>
							<div
								style={{
									display: "flex",
									flexDirection: "row",
									gap: 24,
								}}
							>
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										gap: 4,
									}}
								>
									<span style={{ color: "#9CA3AF", fontSize: 14 }}>
										Models available
									</span>
									<span
										style={{
											fontSize: 26,
											fontWeight: 700,
										}}
									>
										{totalModels || "—"}
									</span>
								</div>
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										gap: 4,
									}}
								>
									<span style={{ color: "#9CA3AF", fontSize: 14 }}>
										Streaming
									</span>
									<span
										style={{
											fontSize: 20,
											fontWeight: 600,
											color: hasStreaming ? "#4ade80" : "#F97316",
										}}
									>
										{hasStreaming ? "Supported" : "Not supported"}
									</span>
								</div>
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										gap: 4,
									}}
								>
									<span style={{ color: "#9CA3AF", fontSize: 14 }}>
										Cancellation
									</span>
									<span
										style={{
											fontSize: 20,
											fontWeight: 600,
											color: hasCancellation ? "#4ade80" : "#F97316",
										}}
									>
										{hasCancellation ? "Supported" : "Not supported"}
									</span>
								</div>
							</div>
						</div>

						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: 8,
								maxWidth: 420,
								alignItems: "flex-end",
								textAlign: "right",
							}}
						>
							<span
								style={{
									color: "#9CA3AF",
									fontSize: 14,
									textTransform: "uppercase",
									letterSpacing: 1,
								}}
							>
								Unified access
							</span>
							<span
								style={{
									fontSize: 18,
									color: "#E5E7EB",
									lineHeight: 1.4,
								}}
							>
								Access {provider.name} models through a single, unified LLM
								Gateway API with built‑in routing, analytics, and cost controls.
							</span>
						</div>
					</div>

					{/* Footer */}
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							justifyContent: "space-between",
							fontSize: 13,
							color: "#9CA3AF",
						}}
					>
						<span>{provider.id}</span>
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
						background: "#020817",
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
