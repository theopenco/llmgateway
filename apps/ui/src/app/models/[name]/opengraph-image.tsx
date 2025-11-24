import { ImageResponse } from "next/og";

import { getProviderIcon } from "@/lib/components/providers-icons";
import Logo from "@/lib/icons/Logo";
import { formatContextSize } from "@/lib/utils";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
	type ModelDefinition,
	type ProviderModelMapping,
} from "@llmgateway/models";

export const size = {
	width: 1200,
	height: 630,
};
export const contentType = "image/png";

interface ImageProps {
	params: Promise<{ name: string }>;
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

export default async function ModelOgImage({ params }: ImageProps) {
	try {
		const { name } = await params;
		const decodedName = decodeURIComponent(name);

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

		const primaryMapping = model.providers[0];
		const providerInfo = providerDefinitions.find(
			(p) => p.id === primaryMapping?.providerId,
		);
		const ProviderIcon = primaryMapping
			? getProviderIcon(primaryMapping.providerId)
			: null;
		const pricing = getEffectivePricePerMillion(primaryMapping);

		const hasStreaming = model.providers.some((p) => p.streaming);
		const hasVision = model.providers.some((p) => p.vision);
		const hasTools = model.providers.some((p) => p.tools);
		const hasReasoning = model.providers.some((p) => p.reasoning);
		const hasJsonOutput = model.providers.some((p) => p.jsonOutput);
		const hasImageGen = Array.isArray((model as any)?.output)
			? ((model as any).output as string[]).includes("image")
			: false;

		const capabilityChips: string[] = [];
		if (hasStreaming) {
			capabilityChips.push("Streaming");
		}
		if (hasVision) {
			capabilityChips.push("Vision");
		}
		if (hasTools) {
			capabilityChips.push("Tools");
		}
		if (hasReasoning) {
			capabilityChips.push("Reasoning");
		}
		if (hasJsonOutput) {
			capabilityChips.push("JSON Output");
		}
		if (hasImageGen) {
			capabilityChips.push("Image Generation");
		}

		const contextValues = model.providers.map((p) => p.contextSize || 0);
		const maxContext =
			contextValues.length > 0 ? Math.max(...contextValues) : 0;

		// Collect unique providers that support this model so we can
		// indicate multi-provider support in the OG image.
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
			const original = `$${value.original.toFixed(2)}/M`;
			const discounted = `$${value.discounted.toFixed(2)}/M`;
			const hasDiscount =
				discountMultiplier !== undefined &&
				discountMultiplier > 0 &&
				discountMultiplier < 1 &&
				value.original !== value.discounted;

			if (hasDiscount) {
				const percentOff = Math.round(discountMultiplier * 100);
				return (
					<>
						<span
							style={{
								textDecoration: "line-through",
								marginRight: 4,
							}}
						>
							{original}
						</span>{" "}
						<span style={{ fontWeight: 700 }}>{discounted}</span> (
						<span style={{ color: "#9CA3AF" }}>{percentOff}% off</span>)
					</>
				);
			}
			return <span style={{ fontWeight: 700 }}>{original}</span>;
		};

		// Simplified layout that respects @vercel/og's requirement that
		// multi-child containers have an explicit display property.
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
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "flex-start",
							gap: 10,
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
								{/* Top-left LLM Gateway logo */}
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
								<span>Model</span>
							</div>
						</div>
						<div
							style={{
								display: "flex",
								flexDirection: "row",
								alignItems: "center",
								gap: 12,
							}}
						>
							<div
								style={{
									width: 44,
									height: 44,
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
									<ProviderIcon width={28} height={28} />
								) : (
									<span
										style={{
											fontSize: 20,
											fontWeight: 700,
										}}
									>
										{(providerInfo?.name || primaryMapping?.providerId || "LLM")
											.charAt(0)
											.toUpperCase()}
									</span>
								)}
							</div>
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									gap: 2,
								}}
							>
								<span style={{ fontSize: 20 }}>{model.name || model.id}</span>
								<span
									style={{
										fontSize: 14,
										color: "#9CA3AF",
									}}
								>
									{providerInfo?.name || primaryMapping?.providerId} •{" "}
									{model.family} family
								</span>
							</div>
						</div>
						{model.description && (
							<div
								style={{
									display: "flex",
									fontSize: 18,
									color: "#D1D5DB",
									lineHeight: 1.4,
									maxWidth: 800,
								}}
							>
								{model.description}
							</div>
						)}

						{supportingProviders.length > 1 && (
							<div
								style={{
									display: "flex",
									flexDirection: "row",
									alignItems: "center",
									gap: 10,
									marginTop: 4,
								}}
							>
								<span
									style={{
										fontSize: 13,
										color: "#9CA3AF",
									}}
								>
									Also supported by
								</span>
								<div
									style={{
										display: "flex",
										flexDirection: "row",
										alignItems: "center",
										gap: 6,
									}}
								>
									{supportingProviders.map(({ id, Icon }) => (
										<div
											key={id}
											style={{
												width: 26,
												height: 26,
												borderRadius: 999,
												backgroundColor: "#020617",
												border: "1px solid rgba(148,163,184,0.4)",
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												overflow: "hidden",
											}}
										>
											<Icon width={18} height={18} />
										</div>
									))}
								</div>
							</div>
						)}
					</div>

					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: 20,
						}}
					>
						<div
							style={{
								display: "flex",
								flexDirection: "row",
								justifyContent: "flex-start",
								alignItems: "flex-start",
								gap: 32,
							}}
						>
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									gap: 6,
									fontSize: 16,
								}}
							>
								<span style={{ color: "#9CA3AF", fontSize: 14 }}>Context</span>
								<span>{maxContext ? formatContextSize(maxContext) : "—"}</span>
								<span
									style={{
										color: "#9CA3AF",
										fontSize: 14,
									}}
								>
									Max output:{" "}
									{primaryMapping?.maxOutput
										? `${formatContextSize(primaryMapping.maxOutput)} tokens`
										: "—"}
								</span>
							</div>

							<div
								style={{
									display: "flex",
									flexDirection: "column",
									gap: 10,
									fontSize: 20,
								}}
							>
								<span
									style={{
										color: "#9CA3AF",
										fontSize: 18,
										fontWeight: 600,
									}}
								>
									Pricing (per 1M tokens)
								</span>
								<div
									style={{
										display: "flex",
										flexDirection: "row",
										gap: 32,
									}}
								>
									<div
										style={{
											display: "flex",
											flexDirection: "column",
											gap: 4,
										}}
									>
										<span
											style={{
												color: "#9CA3AF",
												fontSize: 18,
											}}
										>
											Input
										</span>
										<span
											style={{
												fontSize: 24,
												fontWeight: 700,
											}}
										>
											{formatDollars(
												pricing?.input || undefined,
												primaryMapping?.discount,
											)}
										</span>
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
												color: "#9CA3AF",
												fontSize: 18,
											}}
										>
											Output
										</span>
										<span
											style={{
												fontSize: 24,
												fontWeight: 700,
											}}
										>
											{formatDollars(
												pricing?.output || undefined,
												primaryMapping?.discount,
											)}
										</span>
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
												color: "#9CA3AF",
												fontSize: 18,
											}}
										>
											Cached
										</span>
										<span
											style={{
												fontSize: 24,
												fontWeight: 700,
											}}
										>
											{formatDollars(
												pricing?.cachedInput || undefined,
												primaryMapping?.discount,
											)}
										</span>
									</div>
								</div>
							</div>
						</div>

						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: 8,
								maxWidth: 520,
							}}
						>
							<span style={{ color: "#9CA3AF", fontSize: 14 }}>
								Capabilities
							</span>
							<div
								style={{
									display: "flex",
									flexWrap: "wrap",
									gap: 6,
									fontSize: 13,
								}}
							>
								{capabilityChips.map((cap) => (
									<div
										key={cap}
										style={{
											display: "flex",
											alignItems: "center",
											borderRadius: 999,
											border: "1px solid rgba(148,163,184,0.7)",
											padding: "3px 10px",
											color: "#E5E7EB",
										}}
									>
										{cap}
									</div>
								))}
							</div>
						</div>
					</div>

					<div
						style={{
							display: "flex",
							flexDirection: "row",
							justifyContent: "space-between",
							fontSize: 13,
							color: "#9CA3AF",
						}}
					>
						<span>{decodedName}</span>
						<span>llmgateway.io</span>
					</div>
				</div>
			),
			size,
		);
	} catch (error) {
		console.error("Error generating OpenGraph image:", error);
		// Fallback image to avoid crashing the Jest worker / OG pipeline
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
