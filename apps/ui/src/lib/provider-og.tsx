import { ImageResponse } from "next/og";

import { LogoLockup } from "@/lib/icons/Logo";

import { ogIconSize } from "@llmgateway/shared/components";

export const providerOgSize = {
	width: 1200,
	height: 630,
};

export const providerOgContentType = "image/png";

/** Accent used when a provider carries no brand colour of its own. */
export const defaultProviderAccent = "#38BDF8";

const FONT_STACK = "system-ui, -apple-system, BlinkMacSystemFont, sans-serif";

/** Marks that fit on one row at 60px plus a 12px gutter. */
const LOGO_ROW_LIMIT = 14;

export function hexToRgba(hex: string, alpha: number) {
	const normalized = hex.replace("#", "");
	const full =
		normalized.length === 3
			? normalized
					.split("")
					.map((c) => c + c)
					.join("")
			: normalized;
	const value = Number.parseInt(full, 16);
	if (!Number.isFinite(value) || full.length !== 6) {
		return `rgba(56,189,248,${alpha})`;
	}
	return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

export interface ProviderOgStat {
	label: string;
	value: string;
}

export interface ProviderOgLogo {
	id: string;
	Icon: React.FC<React.SVGProps<SVGSVGElement>>;
}

interface ProviderOgCardProps {
	eyebrow: string;
	title: string;
	subtitle?: string;
	/** Brand colour driving the spine, the bloom and the plate glow. */
	accent?: string;
	/** Hero mark shown on a plate to the left of the title. */
	mark?: React.ReactNode;
	stats: ProviderOgStat[];
	/** Capability pills shown under the title on a single provider's card. */
	chips?: string[];
	/** Provider marks tiled under the title on the directory cards. */
	logos?: ProviderOgLogo[];
}

function Label({ children }: { children: React.ReactNode }) {
	return (
		<span
			style={{
				display: "flex",
				fontSize: 17,
				fontWeight: 600,
				letterSpacing: "0.22em",
				textTransform: "uppercase",
				color: "#6B7280",
			}}
		>
			{children}
		</span>
	);
}

/** Keeps a long provider or country name on two lines at most. */
function titleSize(title: string) {
	if (title.length <= 14) {
		return 92;
	}
	if (title.length <= 26) {
		return 80;
	}
	if (title.length <= 40) {
		return 66;
	}
	return 56;
}

/**
 * A row of provider marks never repeats a logo: several providers share one
 * brand mark (the AWS and Azure entries, for instance) and a repeated tile
 * reads as a rendering bug.
 */
function dedupeLogos(logos: ProviderOgLogo[], limit: number) {
	const seen = new Set<React.FC<React.SVGProps<SVGSVGElement>>>();
	const unique: ProviderOgLogo[] = [];
	for (const logo of logos) {
		if (seen.has(logo.Icon)) {
			continue;
		}
		seen.add(logo.Icon);
		unique.push(logo);
		if (unique.length === limit) {
			break;
		}
	}
	return unique;
}

/**
 * One frame for every provider surface — the directory, a single provider and
 * the per-country pages — so the three share a silhouette in a timeline: a
 * brand-coloured spine down the left edge, corner registration ticks, and a
 * hairline spec rail above the footer.
 */
export function providerOgCard({
	eyebrow,
	title,
	subtitle,
	accent = defaultProviderAccent,
	mark,
	stats,
	chips,
	logos,
}: ProviderOgCardProps) {
	const logoRow = logos ? dedupeLogos(logos, LOGO_ROW_LIMIT) : [];
	const tick = {
		position: "absolute" as const,
		width: 22,
		height: 22,
		display: "flex",
	};

	return new ImageResponse(
		<div
			style={{
				position: "relative",
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				background: "#050506",
				backgroundImage: `radial-gradient(760px 520px at 8% -10%, ${hexToRgba(accent, 0.28)}, transparent 62%), radial-gradient(680px 520px at 108% 116%, rgba(99,102,241,0.18), transparent 60%)`,
				color: "#ffffff",
				fontFamily: FONT_STACK,
				padding: "52px 64px 48px 74px",
				boxSizing: "border-box",
			}}
		>
			{/* Brand spine */}
			<div
				style={{
					position: "absolute",
					left: 0,
					top: 0,
					bottom: 0,
					width: 10,
					display: "flex",
					backgroundImage: `linear-gradient(180deg, ${accent} 0%, ${hexToRgba(accent, 0.35)} 55%, rgba(5,5,6,0) 100%)`,
				}}
			/>

			{/* Registration ticks */}
			<div
				style={{
					...tick,
					left: 40,
					top: 32,
					borderLeft: "1px solid rgba(255,255,255,0.16)",
					borderTop: "1px solid rgba(255,255,255,0.16)",
				}}
			/>
			<div
				style={{
					...tick,
					right: 32,
					top: 32,
					borderRight: "1px solid rgba(255,255,255,0.16)",
					borderTop: "1px solid rgba(255,255,255,0.16)",
				}}
			/>
			<div
				style={{
					...tick,
					left: 40,
					bottom: 32,
					borderLeft: "1px solid rgba(255,255,255,0.16)",
					borderBottom: "1px solid rgba(255,255,255,0.16)",
				}}
			/>
			<div
				style={{
					...tick,
					right: 32,
					bottom: 32,
					borderRight: "1px solid rgba(255,255,255,0.16)",
					borderBottom: "1px solid rgba(255,255,255,0.16)",
				}}
			/>

			{/* Header */}
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					alignItems: "center",
					gap: 18,
				}}
			>
				<LogoLockup style={{ width: 210, height: 32 }} />
				<span style={{ display: "flex", color: "#374151", fontSize: 22 }}>
					/
				</span>
				<Label>{eyebrow}</Label>
			</div>

			{/* Hero */}
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
					flex: 1,
					gap: 30,
					paddingTop: 30,
					paddingBottom: 30,
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						gap: 28,
					}}
				>
					{mark ? (
						<div
							style={{
								width: 124,
								height: 124,
								borderRadius: 30,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								flexShrink: 0,
								color: "#ffffff",
								background: "#0C0C0F",
								backgroundImage: `radial-gradient(120px 120px at 50% 12%, ${hexToRgba(accent, 0.34)}, transparent 70%)`,
								border: `1px solid ${hexToRgba(accent, 0.4)}`,
								boxShadow: `0 24px 70px ${hexToRgba(accent, 0.22)}`,
							}}
						>
							{mark}
						</div>
					) : null}
					<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
						<h1
							style={{
								display: "flex",
								margin: 0,
								fontSize: titleSize(title),
								fontWeight: 800,
								letterSpacing: "-0.035em",
								lineHeight: 1.04,
								maxWidth: mark ? 880 : 1000,
							}}
						>
							{title}
						</h1>
						{subtitle ? (
							<span
								style={{
									display: "flex",
									fontSize: 28,
									lineHeight: 1.35,
									color: "#9CA3AF",
									maxWidth: mark ? 860 : 980,
								}}
							>
								{subtitle}
							</span>
						) : null}
					</div>
				</div>

				{chips?.length ? (
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							gap: 12,
							paddingLeft: mark ? 152 : 0,
						}}
					>
						{chips.map((chip) => (
							<div
								key={chip}
								style={{
									display: "flex",
									alignItems: "center",
									borderRadius: 999,
									border: "1px solid rgba(255,255,255,0.14)",
									background: "rgba(255,255,255,0.03)",
									padding: "10px 22px",
									fontSize: 22,
									color: "#D1D5DB",
								}}
							>
								{chip}
							</div>
						))}
					</div>
				) : null}

				{logoRow.length ? (
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							gap: 12,
						}}
					>
						{logoRow.map(({ id, Icon }) => (
							<div
								key={id}
								style={{
									width: 60,
									height: 60,
									borderRadius: 16,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									color: "#ffffff",
									background: "#0C0C0F",
									border: "1px solid rgba(255,255,255,0.09)",
								}}
							>
								<Icon {...ogIconSize(Icon, 34)} />
							</div>
						))}
					</div>
				) : null}
			</div>

			{/* Spec rail */}
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					alignItems: "stretch",
					borderTop: "1px solid rgba(255,255,255,0.1)",
					paddingTop: 26,
					marginBottom: 26,
				}}
			>
				{stats.map((stat, index) => (
					<div
						key={stat.label}
						style={{
							display: "flex",
							flexDirection: "column",
							gap: 10,
							paddingLeft: index === 0 ? 0 : 36,
							paddingRight: 36,
							borderRight:
								index === stats.length - 1
									? "none"
									: "1px solid rgba(255,255,255,0.1)",
						}}
					>
						<Label>{stat.label}</Label>
						<span
							style={{
								display: "flex",
								fontSize: 40,
								fontWeight: 700,
								letterSpacing: "-0.02em",
							}}
						>
							{stat.value}
						</span>
					</div>
				))}
			</div>

			{/* Footer */}
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					fontSize: 22,
				}}
			>
				<span style={{ display: "flex", color: "#ffffff", fontWeight: 600 }}>
					llmgateway.io
				</span>
				<span style={{ display: "flex", color: "#6B7280" }}>
					One API. Every model.
				</span>
			</div>
		</div>,
		providerOgSize,
	);
}
