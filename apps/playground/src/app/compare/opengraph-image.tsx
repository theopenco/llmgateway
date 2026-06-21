import { ImageResponse } from "next/og";

import {
	LgMark,
	OG_BACKGROUND,
	OG_CONTENT_TYPE,
	OG_GRADIENT,
	OG_SIZE,
	Pill,
} from "@/components/compare/og-shared";
import { comparisons, US } from "@/lib/comparisons";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt =
	"Compare LLM Gateway Chat vs ChatGPT, Claude, Gemini and more";

function monogramOf(name: string): string {
	return name
		.replace(/[^A-Za-z0-9]/g, "")
		.slice(0, 2)
		.toUpperCase();
}

export default function CompareIndexOgImage() {
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
								Comparisons
							</span>
						</div>
					</div>
					<Pill>{US.modelCount} models</Pill>
				</div>

				{/* Hero */}
				<div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
					<span
						style={{
							display: "flex",
							fontSize: 74,
							fontWeight: 800,
							lineHeight: 1.03,
							color: "#FAFAFA",
						}}
					>
						Compare LLM Gateway Chat
					</span>
					<span
						style={{
							display: "flex",
							fontSize: 28,
							lineHeight: 1.3,
							color: "#A1A1AA",
							maxWidth: 1010,
						}}
					>
						Every frontier model on one subscription — see how it stacks up
						against the chat apps you&apos;re evaluating.
					</span>

					{/* Logo line-up */}
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 12,
							marginTop: 8,
						}}
					>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								width: 60,
								height: 60,
								borderRadius: 15,
								background: "#ffffff",
							}}
						>
							<LgMark size={27} color={OG_BACKGROUND} />
						</div>
						<span
							style={{
								fontSize: 18,
								fontWeight: 800,
								color: "#71717A",
								letterSpacing: "0.16em",
								padding: "0 4px",
							}}
						>
							VS
						</span>
						{comparisons.map((c) => (
							<div
								key={c.slug}
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									width: 60,
									height: 60,
									borderRadius: 15,
									background: "rgba(255,255,255,0.08)",
									border: "1px solid rgba(255,255,255,0.14)",
									fontSize: 23,
									fontWeight: 800,
									color: "#FAFAFA",
								}}
							>
								{monogramOf(c.competitor)}
							</div>
						))}
					</div>
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
						<Pill>ChatGPT</Pill>
						<Pill>Claude</Pill>
						<Pill>Gemini</Pill>
						<Pill>Poe</Pill>
						<Pill>Perplexity</Pill>
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
