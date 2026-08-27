import { ImageResponse } from "next/og";

export const alt = "Airside by LLM Gateway — the carrier console";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Night-ops palette, matching the app's dark theme tokens in globals.css.
const BACKGROUND = "#191d27";
const FOREGROUND = "#ebe9e3";
const PRIMARY = "#efab3d";
const MUTED = "#8b8f9c";
const BORDER = "#2b303d";

const BOARD = [
	{ flight: "GLM-5.2", carrier: "EMBERCLOUD", status: "BOARDING" },
	{ flight: "LARGE-4", carrier: "MISTRAL", status: "FARE FILED" },
	{ flight: "K3-TURBO", carrier: "MOONSHOT", status: "ON TIME" },
];

function BeaconMark() {
	return (
		<svg width="52" height="52" viewBox="0 0 32 32" fill="none">
			<rect width="32" height="32" rx="7" fill={FOREGROUND} />
			<circle cx="16" cy="16" r="3" fill={BACKGROUND} />
			<path d="M16 16 L28 10 L28 22 Z" fill={BACKGROUND} opacity="0.55" />
			<circle
				cx="16"
				cy="16"
				r="8.5"
				stroke={BACKGROUND}
				strokeWidth="1.5"
				strokeDasharray="3 4"
				fill="none"
				opacity="0.7"
			/>
		</svg>
	);
}

export default function AirsideOgImage() {
	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				background: BACKGROUND,
				backgroundImage: `radial-gradient(900px 520px at 78% -12%, rgba(239,171,61,0.18), transparent 62%)`,
				padding: 64,
				fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 16 }}>
				<BeaconMark />
				<span
					style={{
						color: FOREGROUND,
						fontSize: 34,
						fontWeight: 800,
						letterSpacing: "0.02em",
					}}
				>
					AIRSIDE
				</span>
				<span style={{ color: MUTED, fontSize: 22 }}>by LLM Gateway</span>
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
				<span
					style={{
						color: PRIMARY,
						fontSize: 20,
						letterSpacing: "0.3em",
						textTransform: "uppercase",
					}}
				>
					The carrier console
				</span>
				<span
					style={{
						display: "flex",
						color: FOREGROUND,
						fontSize: 66,
						fontWeight: 800,
						lineHeight: 1.08,
						letterSpacing: "-0.02em",
						maxWidth: 940,
					}}
				>
					Put your models on the departure board.
				</span>
				<span style={{ display: "flex", color: MUTED, fontSize: 27 }}>
					Claim your carrier, register your fleet, file your fares — and win
					routes.
				</span>
			</div>

			<div
				style={{
					display: "flex",
					flexDirection: "column",
					borderTop: `1px solid ${BORDER}`,
					paddingTop: 22,
				}}
			>
				{BOARD.map((row) => (
					<div
						key={row.flight}
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							paddingTop: 7,
							paddingBottom: 7,
							fontSize: 21,
							letterSpacing: "0.12em",
						}}
					>
						<span style={{ color: FOREGROUND, width: 250 }}>{row.flight}</span>
						<span style={{ color: MUTED, width: 320 }}>{row.carrier}</span>
						<span style={{ color: PRIMARY }}>{row.status}</span>
					</div>
				))}
			</div>
		</div>,
		size,
	);
}
