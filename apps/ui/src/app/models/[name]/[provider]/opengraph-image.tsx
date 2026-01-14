import { ImageResponse } from "next/og";

import Logo from "@/lib/icons/Logo";
import { formatContextSize } from "@/lib/utils";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
	type ModelDefinition,
	type ProviderModelMapping,
} from "@llmgateway/models";
import { getProviderIcon } from "@llmgateway/shared/components";

export const size = {
	width: 1200,
	height: 630,
};
export const contentType = "image/png";

interface ImageProps {
	params: Promise<{ name: string; provider: string }>;
}

function getEffectivePricePerMillion(
	mapping: ProviderModelMapping | undefined,
) {
	if (
		!mapping?.inputPrice &&
		!mapping?.outputPrice &&
		!mapping?.cachedInputPrice
	) {
		return null;
	}

	const applyDiscount = (price?: number | null) => {
		if (price === undefined || price === null) {
			return undefined;
		}
		const base = price * 1e6;
		if (!mapping?.discount) {
			return { original: base, discounted: base };
		}
		return {
			original: base,
			discounted: base * (1 - mapping.discount),
		};
	};

	return {
		input: applyDiscount(mapping.inputPrice),
		output: applyDiscount(mapping.outputPrice),
		cachedInput: applyDiscount(mapping.cachedInputPrice),
	};
}

export default async function ModelProviderOgImage({ params }: ImageProps) {
	try {
		const { name, provider } = await params;
		const decodedName = decodeURIComponent(name);
		const decodedProvider = decodeURIComponent(provider);

		const model = modelDefinitions.find((m) => m.id === decodedName) as
			| ModelDefinition
			| undefined;

		if (!model) {
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
						Model not found
					</div>
				),
				size,
			);
		}

		const selectedMapping =
			model.providers.find((p) => p.providerId === decodedProvider) ||
			model.providers[0];
		const providerInfo = providerDefinitions.find(
			(p) => p.id === selectedMapping?.providerId,
		);
		const ProviderIcon = selectedMapping
			? getProviderIcon(selectedMapping.providerId)
			: null;
		const pricing = getEffectivePricePerMillion(selectedMapping);
		const requestPrice = selectedMapping?.requestPrice;
		const hasTokenPricing =
			pricing?.input || pricing?.output || pricing?.cachedInput;

		const contextSize = selectedMapping?.contextSize || 0;

		const uniqueProviderIds = Array.from(
			new Set(model.providers.map((p) => p.providerId)),
		);
		const supportingProviders = uniqueProviderIds
			.map((providerId) => {
				const icon = getProviderIcon(providerId);
				const info = providerDefinitions.find((p) => p.id === providerId);
				return {
					id: providerId,
					name: info?.name || providerId,
					Icon: icon,
				};
			})
			.filter((p) => !!p.Icon) as {
			id: string;
			name: string;
			Icon: React.FC<React.SVGProps<SVGSVGElement>>;
		}[];

		const formatDollars = (
			value?: {
				original: number;
				discounted: number;
			},
			discountMultiplier?: number,
		) => {
			if (!value) {
				return "—";
			}
			const original = `$${value.original.toFixed(2)}`;
			const discounted = `$${value.discounted.toFixed(2)}`;
			const hasDiscount =
				discountMultiplier !== undefined &&
				discountMultiplier > 0 &&
				discountMultiplier < 1 &&
				value.original !== value.discounted;

			if (hasDiscount) {
				const percentOff = Math.round(discountMultiplier * 100);
				return (
					<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
						<div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
							<span
								style={{
									textDecoration: "line-through",
									color: "#6B7280",
									fontSize: 36,
								}}
							>
								{original}
							</span>
							<span style={{ fontWeight: 700, fontSize: 56 }}>
								{discounted}
							</span>
						</div>
						<span
							style={{
								color: "#10B981",
								fontSize: 22,
								fontWeight: 600,
							}}
						>
							{percentOff}% off
						</span>
					</div>
				);
			}
			return <span style={{ fontWeight: 700, fontSize: 56 }}>{original}</span>;
		};

		return new ImageResponse(
			(
				<div
					style={{
						width: "100%",
						height: "100%",
						display: "flex",
						flexDirection: "column",
						justifyContent: "space-between",
						background: "#000000",
						color: "white",
						fontFamily:
							"system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
						padding: 56,
						boxSizing: "border-box",
					}}
				>
					{/* Header */}
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							justifyContent: "space-between",
							alignItems: "flex-start",
						}}
					>
						<div
							style={{
								display: "flex",
								flexDirection: "row",
								alignItems: "center",
								gap: 20,
							}}
						>
							<div
								style={{
									width: 88,
									height: 88,
									borderRadius: 20,
									backgroundColor: "#111827",
									border: "2px solid rgba(148,163,184,0.3)",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									overflow: "hidden",
								}}
							>
								{ProviderIcon ? (
									<ProviderIcon width={56} height={56} />
								) : (
									<span
										style={{
											fontSize: 36,
											fontWeight: 700,
										}}
									>
										{(
											providerInfo?.name ||
											selectedMapping?.providerId ||
											"LLM"
										)
											.charAt(0)
											.toUpperCase()}
									</span>
								)}
							</div>
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									gap: 6,
								}}
							>
								<span
									style={{
										fontSize: 52,
										fontWeight: 700,
										letterSpacing: "-0.02em",
									}}
								>
									{model.name || model.id}
								</span>
								<div
									style={{
										display: "flex",
										flexDirection: "row",
										alignItems: "center",
										gap: 10,
										fontSize: 24,
										color: "#9CA3AF",
									}}
								>
									<span>
										{providerInfo?.name || selectedMapping?.providerId}
									</span>
									<span style={{ opacity: 0.5 }}>•</span>
									<span>{model.family} family</span>
								</div>
							</div>
						</div>

						{supportingProviders.length > 1 && (
							<div
								style={{
									display: "flex",
									flexDirection: "row",
									alignItems: "center",
									gap: 8,
								}}
							>
								{supportingProviders.map(({ id, Icon }) => (
									<div
										key={id}
										style={{
											width: 48,
											height: 48,
											borderRadius: 12,
											backgroundColor: "#111827",
											border: "1px solid rgba(148,163,184,0.3)",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											overflow: "hidden",
										}}
									>
										<Icon width={30} height={30} />
									</div>
								))}
							</div>
						)}
					</div>

					{/* Pricing Grid - Main Focus */}
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: 28,
						}}
					>
						{(hasTokenPricing || requestPrice) && (
							<span
								style={{
									color: "#6B7280",
									fontSize: 24,
									fontWeight: 500,
									textTransform: "uppercase",
									letterSpacing: "0.1em",
								}}
							>
								{requestPrice ? "Pricing" : "Pricing per 1M tokens"}
							</span>
						)}
						<div
							style={{
								display: "flex",
								flexDirection: "row",
								gap: 32,
							}}
						>
							{/* Context */}
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									gap: 10,
									padding: "28px 36px",
									backgroundColor: "#0A0A0A",
									borderRadius: 20,
									border: "1px solid #1F2937",
								}}
							>
								<span
									style={{
										color: "#9CA3AF",
										fontSize: 20,
										fontWeight: 500,
										textTransform: "uppercase",
										letterSpacing: "0.05em",
									}}
								>
									Context
								</span>
								<span style={{ fontSize: 56, fontWeight: 700 }}>
									{contextSize ? formatContextSize(contextSize) : "—"}
								</span>
							</div>

							{/* Request Price */}
							{requestPrice && (
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										gap: 10,
										padding: "28px 36px",
										backgroundColor: "#0A0A0A",
										borderRadius: 20,
										border: "1px solid #1F2937",
									}}
								>
									<span
										style={{
											color: "#9CA3AF",
											fontSize: 20,
											fontWeight: 500,
											textTransform: "uppercase",
											letterSpacing: "0.05em",
										}}
									>
										Price per Request
									</span>
									<span style={{ fontWeight: 700, fontSize: 56 }}>
										${requestPrice.toFixed(4)}
									</span>
								</div>
							)}

							{/* Input - only show if has token pricing */}
							{hasTokenPricing && (
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										gap: 10,
										padding: "28px 36px",
										backgroundColor: "#0A0A0A",
										borderRadius: 20,
										border: "1px solid #1F2937",
									}}
								>
									<span
										style={{
											color: "#9CA3AF",
											fontSize: 20,
											fontWeight: 500,
											textTransform: "uppercase",
											letterSpacing: "0.05em",
										}}
									>
										Input
									</span>
									{formatDollars(
										pricing?.input || undefined,
										selectedMapping?.discount,
									)}
								</div>
							)}

							{/* Output - only show if has token pricing */}
							{hasTokenPricing && (
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										gap: 10,
										padding: "28px 36px",
										backgroundColor: "#0A0A0A",
										borderRadius: 20,
										border: "1px solid #1F2937",
									}}
								>
									<span
										style={{
											color: "#9CA3AF",
											fontSize: 20,
											fontWeight: 500,
											textTransform: "uppercase",
											letterSpacing: "0.05em",
										}}
									>
										Output
									</span>
									{formatDollars(
										pricing?.output || undefined,
										selectedMapping?.discount,
									)}
								</div>
							)}
						</div>
					</div>

					{/* Footer */}
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							justifyContent: "space-between",
							alignItems: "center",
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
							<div
								style={{
									width: 44,
									height: 44,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									color: "#ffffff",
								}}
							>
								<Logo style={{ width: 40, height: 40 }} />
							</div>
							<span
								style={{
									fontSize: 26,
									fontWeight: 600,
									color: "#E5E7EB",
								}}
							>
								LLM Gateway
							</span>
						</div>
						<span
							style={{
								fontSize: 24,
								color: "#6B7280",
							}}
						>
							llmgateway.io
						</span>
					</div>
				</div>
			),
			size,
		);
	} catch (error) {
		console.error("Error generating OpenGraph image:", error);
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
					LLM Gateway Model
				</div>
			),
			size,
		);
	}
}
