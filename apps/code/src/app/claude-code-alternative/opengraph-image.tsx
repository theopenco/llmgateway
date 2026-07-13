import { ImageResponse } from "next/og";

import { getBrand, type BrandSpec } from "@/components/brand-logos";

export const alt =
	"DevPass — the Claude Code alternative that keeps Claude Code";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function Tile({ spec, devpass }: { spec: BrandSpec; devpass?: boolean }) {
	const tileSize = 150;
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
				borderRadius: 32,
				background,
				color,
				border: "1px solid rgba(255,255,255,0.12)",
				boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
			}}
		>
			{Mark ? (
				<Mark size={inner} />
			) : (
				<span style={{ fontSize: 72, fontWeight: 700, lineHeight: 1 }}>
					{spec.mono ?? spec.label.charAt(0)}
				</span>
			)}
		</div>
	);
}

export default function ClaudeCodeAlternativeOgImage() {
	const devpassSpec = getBrand("devpass");
	const claudeSpec = getBrand("claude");

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
				{/* Header */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
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
							padding: "10px 20px",
							borderRadius: 9999,
							background: "rgba(255,255,255,0.06)",
							border: "1px solid rgba(255,255,255,0.14)",
							color: "#d4d4d8",
							fontSize: 20,
							fontWeight: 600,
							letterSpacing: 2,
							textTransform: "uppercase",
						}}
					>
						Alternative
					</div>
				</div>

				{/* Arena */}
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						gap: 34,
					}}
				>
					<div style={{ display: "flex", alignItems: "center", gap: 44 }}>
						<Tile spec={devpassSpec} devpass />
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								width: 72,
								height: 72,
								borderRadius: 9999,
								background: "#18181b",
								border: "1px solid rgba(255,255,255,0.16)",
								color: "#a1a1aa",
								fontSize: 26,
								fontWeight: 700,
								letterSpacing: 1,
							}}
						>
							VS
						</div>
						<Tile spec={claudeSpec} />
					</div>

					<div
						style={{
							display: "flex",
							color: "#fafafa",
							fontSize: 60,
							fontWeight: 700,
							letterSpacing: "-0.02em",
							textAlign: "center",
						}}
					>
						The Claude Code alternative
					</div>
				</div>

				{/* Footer */}
				<div
					style={{
						display: "flex",
						alignItems: "flex-end",
						justifyContent: "space-between",
					}}
				>
					<div style={{ display: "flex", gap: 40 }}>
						<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
							<span style={{ color: "#71717a", fontSize: 18 }}>DevPass</span>
							<span style={{ color: "#fafafa", fontSize: 26, fontWeight: 600 }}>
								$29–$179/mo
							</span>
						</div>
						<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
							<span style={{ color: "#71717a", fontSize: 18 }}>Claude Max</span>
							<span style={{ color: "#d4d4d8", fontSize: 26, fontWeight: 600 }}>
								$100–$200/mo
							</span>
						</div>
					</div>
					<span style={{ color: "#71717a", fontSize: 20 }}>
						devpass.llmgateway.io
					</span>
				</div>
			</div>
		),
		size,
	);
}
