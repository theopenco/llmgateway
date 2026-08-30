import { ImageResponse } from "next/og";

import { discountFraction, getEffectiveProviderDiscount } from "@/lib/discount";
import { fetchModelDiscounts } from "@/lib/fetch-models";
import Logo from "@/lib/icons/Logo";
import { formatContextSize } from "@/lib/utils";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
	type ModelDefinition,
	type ProviderModelMapping,
} from "@llmgateway/models";
import {
	AWSBedrockIconStatic,
	FireworksIconStatic,
	getProviderIcon,
	GoogleStudioAIIconStatic,
	MinimaxIconStatic,
	XAIIconStatic,
} from "@llmgateway/shared/components";

export const size = {
	width: 1200,
	height: 630,
};
export const contentType = "image/png";
export const revalidate = 60;
export const dynamicParams = false;

const getOgProviderIcon = (providerId: string) => {
	if (providerId === "aws-bedrock" || providerId === "aws-mantle") {
		return AWSBedrockIconStatic;
	}
	if (providerId === "minimax") {
		return MinimaxIconStatic;
	}
	if (providerId === "google-ai-studio") {
		return GoogleStudioAIIconStatic;
	}
	if (providerId === "xai") {
		return XAIIconStatic;
	}
	if (providerId === "fireworks") {
		return FireworksIconStatic;
	}
	return getProviderIcon(providerId);
};

export function generateStaticParams() {
	const params: { name: string; provider: string }[] = [];

	for (const model of modelDefinitions) {
		const uniqueProviders = Array.from(
			new Set(model.providers.map((mapping) => mapping.providerId)),
		);
		for (const providerId of uniqueProviders) {
			params.push({
				name: encodeURIComponent(model.id),
				provider: encodeURIComponent(providerId),
			});
		}
	}

	return params;
}

interface ImageProps {
	params: Promise<{ name: string; provider: string }>;
}

function getEffectivePricePerMillion(
	mapping: ProviderModelMapping | undefined,
	discount: number,
) {
	if (
		!mapping?.inputPrice &&
		!mapping?.outputPrice &&
		!mapping?.cachedInputPrice
	) {
		return null;
	}

	const applyDiscount = (price?: string | number | null) => {
		if (price === undefined || price === null) {
			return undefined;
		}
		const base = Number(price) * 1e6;
		if (!discount) {
			return { original: base, discounted: base };
		}
		return {
			original: base,
			discounted: base * (1 - discount),
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
			ModelDefinition | undefined;

		if (!model) {
			return new ImageResponse(
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
				</div>,
				size,
			);
		}

		const selectedMapping =
			model.providers.find((p) => p.providerId === decodedProvider) ??
			model.providers[0];
		const providerInfo = providerDefinitions.find(
			(p) => p.id === selectedMapping?.providerId,
		);
		const ProviderIcon = selectedMapping
			? getOgProviderIcon(selectedMapping.providerId)
			: null;
		const discounts = await fetchModelDiscounts(decodedName);
		const effectiveDiscount = selectedMapping
			? getEffectiveProviderDiscount(
					discounts,
					selectedMapping.providerId,
					decodedName,
				)
			: undefined;
		const discountNum = discountFraction(effectiveDiscount);

		const hasPricingTiers = (selectedMapping?.pricingTiers?.length ?? 0) > 1;
		const pricing = getEffectivePricePerMillion(selectedMapping, discountNum);
		const requestPrice =
			selectedMapping?.requestPrice !== undefined
				? Number(selectedMapping.requestPrice)
				: undefined;
		const perSecondPrice = selectedMapping?.perSecondPrice
			? Object.fromEntries(
					Object.entries(selectedMapping.perSecondPrice).map(([k, v]) => [
						k,
						Number(v),
					]),
				)
			: undefined;
		const perImagePrice = selectedMapping?.perImagePrice
			? Object.fromEntries(
					Object.entries(selectedMapping.perImagePrice).map(([k, v]) => [
						k,
						Number(v),
					]),
				)
			: undefined;
		const isVideoGen = selectedMapping?.videoGenerations === true;
		const isImageGen = selectedMapping?.imageGenerations === true;
		const isOcr = selectedMapping?.ocr === true;
		const ocrPagePrice =
			selectedMapping?.ocrPagePrice !== undefined &&
			selectedMapping?.ocrPagePrice !== null
				? Number(selectedMapping.ocrPagePrice)
				: undefined;
		const hasOcrPricing = ocrPagePrice !== undefined && ocrPagePrice > 0;
		const inputCharacterPrice =
			selectedMapping?.inputCharacterPrice !== undefined
				? Number(selectedMapping.inputCharacterPrice)
				: undefined;
		const hasCharPricing =
			inputCharacterPrice !== undefined && inputCharacterPrice > 0;
		const inputAudioHourPrice =
			selectedMapping?.inputAudioHourPrice !== undefined
				? Number(selectedMapping.inputAudioHourPrice)
				: undefined;
		const hasAudioHourPricing =
			inputAudioHourPrice !== undefined &&
			inputAudioHourPrice > 0 &&
			!(Number(selectedMapping?.inputPrice ?? 0) > 0) &&
			!(Number(selectedMapping?.outputPrice ?? 0) > 0);
		const hasPerImagePricing =
			isImageGen &&
			perImagePrice !== undefined &&
			Object.keys(perImagePrice).length > 0;
		const hasPositiveTokenPrice = [
			pricing?.input,
			pricing?.output,
			pricing?.cachedInput,
		].some((p) => (p?.original ?? 0) > 0);
		// Per-image mappings declare token prices as the string "0" — placeholder
		// values, not real token pricing — so zero token prices only count when
		// the mapping has no per-image pricing to show instead.
		const hasTokenPricing =
			!isOcr &&
			!hasCharPricing &&
			!hasAudioHourPricing &&
			Boolean(pricing?.input ?? pricing?.output ?? pricing?.cachedInput) &&
			(hasPositiveTokenPrice || !hasPerImagePricing);

		const contextSize = selectedMapping?.contextSize ?? 0;

		const uniqueProviderIds = Array.from(
			new Set(model.providers.map((p) => p.providerId)),
		);
		const supportingProviders = uniqueProviderIds
			.map((providerId) => {
				const icon = getOgProviderIcon(providerId);
				const info = providerDefinitions.find((p) => p.id === providerId);
				return {
					id: providerId,
					name: info?.name ?? providerId,
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

		const formatUnitPrice = (value: number, unit: string) => {
			const format = (v: number) => `$${parseFloat(v.toFixed(4))}`;
			const hasDiscount = discountNum > 0 && discountNum < 1;
			return (
				<div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
					{hasDiscount ? (
						<>
							<span
								style={{
									textDecoration: "line-through",
									color: "#6B7280",
									fontSize: 36,
								}}
							>
								{format(value)}
							</span>
							<span style={{ fontWeight: 700, fontSize: 56 }}>
								{format(value * (1 - discountNum))}
							</span>
						</>
					) : (
						<span style={{ fontWeight: 700, fontSize: 56 }}>
							{format(value)}
						</span>
					)}
					<span style={{ color: "#9CA3AF", fontSize: 26 }}>{unit}</span>
				</div>
			);
		};

		return new ImageResponse(
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
										providerInfo?.name ??
										(selectedMapping?.providerId || "LLM")
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
								{model.name ?? model.id}
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
								<span>{providerInfo?.name ?? selectedMapping?.providerId}</span>
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
					{(hasTokenPricing ||
						(requestPrice !== undefined && requestPrice !== 0) ||
						(perSecondPrice && Object.keys(perSecondPrice).length > 0) ||
						(perImagePrice && Object.keys(perImagePrice).length > 0) ||
						hasOcrPricing ||
						hasCharPricing ||
						hasAudioHourPricing) && (
						<span
							style={{
								color: "#6B7280",
								fontSize: 24,
								fontWeight: 500,
								textTransform: "uppercase",
								letterSpacing: "0.1em",
							}}
						>
							{hasAudioHourPricing
								? "Audio Transcription Pricing"
								: hasCharPricing
									? "Per Character Pricing"
									: isVideoGen && perSecondPrice
										? "Pricing per second"
										: hasOcrPricing
											? "Pricing per 1K pages"
											: isImageGen && perImagePrice && !hasTokenPricing
												? "Pricing per image"
												: isImageGen &&
													  requestPrice !== undefined &&
													  requestPrice !== 0 &&
													  !hasTokenPricing
													? "Pricing per request"
													: requestPrice !== undefined && requestPrice !== 0
														? "Pricing"
														: "Pricing per 1M tokens"}
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

						{/* Per-hour input audio price for transcription models */}
						{hasAudioHourPricing && (
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
									Input audio
								</span>
								{formatUnitPrice(inputAudioHourPrice ?? 0, "/hour")}
							</div>
						)}

						{/* Per-character input text price for speech models */}
						{hasCharPricing && (
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
									Input text
								</span>
								{formatUnitPrice(
									(inputCharacterPrice ?? 0) * 1000,
									"/1K chars",
								)}
							</div>
						)}

						{/* Per-Second Price for video gen */}
						{isVideoGen &&
							perSecondPrice &&
							Object.entries(perSecondPrice)
								.slice(0, 2)
								.map(([key, price]) => {
									const discount = selectedMapping?.discount
										? Number(selectedMapping.discount)
										: 0;
									const validDiscount =
										Number.isFinite(discount) && discount > 0 && discount <= 1
											? discount
											: 0;
									const eff =
										validDiscount > 0 ? price * (1 - validDiscount) : price;
									return (
										<div
											key={key}
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
												{key === "default"
													? "Per Second"
													: key.replace(/_/g, " ")}
											</span>
											<span style={{ fontWeight: 700, fontSize: 56 }}>
												${eff.toFixed(4)}
											</span>
										</div>
									);
								})}

						{/* Per-Image Price for image gen, tiered by output resolution.
						    Fall back to the "default" tier when it is the only entry. */}
						{isImageGen &&
							perImagePrice &&
							(() => {
								const tierEntries = Object.entries(perImagePrice).filter(
									([key]) => key !== "default",
								);
								const entries =
									tierEntries.length > 0
										? tierEntries
										: Object.entries(perImagePrice);
								return entries.slice(0, 2).map(([key, price]) => (
									<div
										key={key}
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
											{key === "default" ? "Per Image" : `Per Image (${key})`}
										</span>
										{formatUnitPrice(price, "/image")}
									</div>
								));
							})()}

						{/* Request Price */}
						{requestPrice !== undefined && requestPrice !== 0 && (
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
									Per Request
								</span>
								<span style={{ fontWeight: 700, fontSize: 56 }}>
									${requestPrice.toFixed(4)}
								</span>
							</div>
						)}

						{/* OCR per-1K-pages price */}
						{ocrPagePrice !== undefined && ocrPagePrice > 0 && (
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
									Per 1K Pages
								</span>
								<span style={{ fontWeight: 700, fontSize: 56 }}>
									${(ocrPagePrice * 1000).toFixed(2)}
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
									{hasPricingTiers ? "Input (starting at)" : "Input"}
								</span>
								{formatDollars(pricing?.input ?? undefined, discountNum)}
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
									{hasPricingTiers ? "Output (starting at)" : "Output"}
								</span>
								{formatDollars(pricing?.output ?? undefined, discountNum)}
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
			</div>,
			size,
		);
	} catch (error) {
		console.error("Error generating OpenGraph image:", error);
		return new ImageResponse(
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
			</div>,
			size,
		);
	}
}
