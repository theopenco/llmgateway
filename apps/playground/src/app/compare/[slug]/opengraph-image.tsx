import { ImageResponse } from "next/og";

import {
	LgMark,
	OG_BACKGROUND,
	OG_CONTENT_TYPE,
	OG_GRADIENT,
	OG_SIZE,
	Pill,
	clipText,
} from "@/components/compare/og-shared";
import { getComparison, getComparisonSlugs, US } from "@/lib/comparisons";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "LLM Gateway Chat vs the alternatives";

export function generateStaticParams() {
	return getComparisonSlugs().map((slug) => ({ slug }));
}

function monogramOf(name: string): string {
	return name
		.replace(/[^A-Za-z0-9]/g, "")
		.slice(0, 2)
		.toUpperCase();
}

export default async function CompareOgImage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const comparison = getComparison(slug);
	const competitor = comparison?.competitor ?? "the alternatives";
	const tagline =
		comparison?.competitorTagline ?? "Every model, one subscription";
	const plusValue = US.plans.plus.value;
	const plusCredits = Number.isInteger(plusValue)
		? String(plusValue)
		: plusValue.toFixed(2);

	return new ImageResponse(
		(
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					flexDirection: "column",
					justifyContent: "space-between",
					background: OG_BACKGROUND,
					backgroundImage: OG_GRADIENT,
					color: "white",
					fontFamily:
						"system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
					padding: 64,
					boxSizing: "border-box",
				}}
			>
				{/* Header */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						width: "100%",
					}}
				>
					<div style={{ display: "flex", alignItems: "center", gap: 16 }}>
						<LgMark size={44} />
						<div style={{ display: "flex", flexDirection: "column" }}>
							<span style={{ fontSize: 26, fontWeight: 700 }}>LLM Gateway</span>
							<span
								style={{
									fontSize: 16,
									color: "#A1A1AA",
									letterSpacing: "0.02em",
								}}
							>
								Chat comparison
							</span>
						</div>
					</div>
					<Pill>{US.modelCount} models</Pill>
				</div>

				{/* Hero: face-off */}
				<div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
					<div style={{ display: "flex", alignItems: "center", gap: 20 }}>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								width: 92,
								height: 92,
								borderRadius: 22,
								background: "#ffffff",
							}}
						>
							<LgMark size={40} color={OG_BACKGROUND} />
						</div>
						<span
							style={{
								fontSize: 24,
								fontWeight: 800,
								color: "#71717A",
								letterSpacing: "0.18em",
							}}
						>
							VS
						</span>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								width: 92,
								height: 92,
								borderRadius: 22,
								background: "rgba(255,255,255,0.08)",
								border: "1px solid rgba(255,255,255,0.14)",
								fontSize: 36,
								fontWeight: 800,
								color: "#FAFAFA",
							}}
						>
							{monogramOf(competitor)}
						</div>
					</div>

					<span
						style={{
							display: "flex",
							fontSize: competitor.length > 12 ? 60 : 68,
							fontWeight: 800,
							lineHeight: 1.04,
							color: "#FAFAFA",
							maxWidth: 1010,
						}}
					>
						LLM Gateway Chat vs {competitor}
					</span>
					<span
						style={{
							display: "flex",
							fontSize: 27,
							lineHeight: 1.3,
							color: "#A1A1AA",
							maxWidth: 1000,
						}}
					>
						{clipText(tagline, 92)}
					</span>
				</div>

				{/* Footer */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						width: "100%",
					}}
				>
					<div style={{ display: "flex", gap: 10 }}>
						<Pill>Every frontier model</Pill>
						<Pill>One subscription</Pill>
						<Pill>${plusCredits} credits on Plus</Pill>
					</div>
					<span style={{ color: "#A1A1AA", fontSize: 21, fontWeight: 500 }}>
						chat.llmgateway.io
					</span>
				</div>
			</div>
		),
		size,
	);
}
