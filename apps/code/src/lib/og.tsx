import { ImageResponse } from "next/og";

export const ogSize = { width: 1200, height: 630 };
export const ogContentType = "image/png";

interface DevPassOgOptions {
	eyebrow: string;
	title: string;
	subtitle: string;
	path: string;
}

/**
 * Shared DevPass OpenGraph card so every marketing page ships a branded
 * 1200x630 image. Inline styles only — rendered by next/og (Satori).
 */
export function devpassOgImage({
	eyebrow,
	title,
	subtitle,
	path,
}: DevPassOgOptions) {
	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				background: "#0a0a0b",
				backgroundImage:
					"radial-gradient(900px 500px at 50% -10%, rgba(255,255,255,0.10), transparent 60%), radial-gradient(700px 420px at 100% 110%, rgba(16,185,129,0.14), transparent 60%)",
				padding: 64,
				fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
			}}
		>
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
					{eyebrow}
				</div>
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
				<div
					style={{
						display: "flex",
						color: "#fafafa",
						fontSize: 72,
						fontWeight: 700,
						lineHeight: 1.05,
						letterSpacing: "-0.02em",
						maxWidth: 1000,
					}}
				>
					{title}
				</div>
				<div
					style={{
						display: "flex",
						color: "#a1a1aa",
						fontSize: 30,
						lineHeight: 1.35,
						maxWidth: 900,
					}}
				>
					{subtitle}
				</div>
			</div>

			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					color: "#71717a",
					fontSize: 20,
				}}
			>
				<span style={{ color: "#fafafa", fontWeight: 600 }}>
					devpass.llmgateway.io{path}
				</span>
				<span>One key. Every model. Flat price.</span>
			</div>
		</div>,
		ogSize,
	);
}
