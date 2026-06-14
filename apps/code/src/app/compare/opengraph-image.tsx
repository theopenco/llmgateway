import { ImageResponse } from "next/og";

import { getBrand, type BrandSpec } from "@/components/brand-logos";

import { allComparisons } from "content-collections";

import type { Comparison } from "content-collections";

export const alt = "DevPass vs the alternatives — coding plan comparisons";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function Tile({ spec, devpass }: { spec: BrandSpec; devpass?: boolean }) {
	const tileSize = 96;
	const inner = Math.round(tileSize * spec.scale);
	const background = devpass ? "#fafafa" : spec.bg;
	const color = devpass ? "#0a0a0b" : spec.fg;
	const Mark = spec.Mark;

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				width: tileSize,
				height: tileSize,
				borderRadius: 22,
				background,
				color,
				border: "1px solid rgba(255,255,255,0.12)",
				boxShadow: "0 18px 40px rgba(0,0,0,0.4)",
			}}
		>
			{Mark ? (
				<Mark size={inner} />
			) : (
				<span style={{ fontSize: 44, fontWeight: 700, lineHeight: 1 }}>
					{spec.mono ?? spec.label.charAt(0)}
				</span>
			)}
		</div>
	);
}

export default function CompareIndexOgImage() {
	const competitors = allComparisons
		.filter((e: Comparison) => !e.draft)
		.sort((a: Comparison, b: Comparison) =>
			a.competitor.localeCompare(b.competitor),
		)
		.map((e: Comparison) => getBrand(e.competitorLogo ?? e.competitor));

	return new ImageResponse(
		(
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					flexDirection: "column",
					justifyContent: "space-between",
					background: "#0a0a0b",
					backgroundImage:
						"radial-gradient(900px 500px at 50% -10%, rgba(255,255,255,0.10), transparent 60%)",
					padding: 64,
					fontFamily:
						"system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 14 }}>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							width: 44,
							height: 44,
							borderRadius: 12,
							background: "#fafafa",
							color: "#0a0a0b",
							fontSize: 22,
							fontWeight: 700,
						}}
					>
						{"</>"}
					</div>
					<div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
						<span style={{ color: "#fafafa", fontSize: 30, fontWeight: 700 }}>
							DevPass
						</span>
						<span style={{ color: "#71717a", fontSize: 20 }}>
							by LLM Gateway
						</span>
					</div>
				</div>

				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 28,
					}}
				>
					<div
						style={{
							display: "flex",
							color: "#fafafa",
							fontSize: 76,
							fontWeight: 700,
							letterSpacing: "-0.02em",
						}}
					>
						DevPass vs the alternatives
					</div>
					<div style={{ display: "flex", color: "#a1a1aa", fontSize: 30 }}>
						One key to 200+ models — frontier and open-weight — at provider
						rates.
					</div>

					{/* Logo lineup */}
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 16,
							marginTop: 12,
						}}
					>
						<Tile spec={getBrand("devpass")} devpass />
						<span
							style={{
								display: "flex",
								color: "#52525b",
								fontSize: 22,
								fontWeight: 700,
								letterSpacing: 4,
								padding: "0 4px",
							}}
						>
							VS
						</span>
						{competitors.map((spec, i) => (
							<Tile key={i} spec={spec} />
						))}
					</div>
				</div>

				<div
					style={{
						display: "flex",
						justifyContent: "flex-end",
						color: "#71717a",
						fontSize: 20,
					}}
				>
					devpass.llmgateway.io/compare
				</div>
			</div>
		),
		size,
	);
}
