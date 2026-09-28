import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";
import sharp from "sharp";

import { LogoLockup } from "@/lib/icons/Logo";
import { ogSize } from "@/lib/og";

import { MARKETING_STATS } from "@llmgateway/shared";

import type { ReactNode } from "react";

const INK = "#09090b";
const PAPER = "#f4f1e8";
const MUTED = "rgba(244,241,232,0.64)";
const FAINT = "rgba(244,241,232,0.42)";
const AMBER = "#fcd34d";

const fontDir = join(process.cwd(), "src/assets/og-fonts");
const fontFiles = Promise.all([
	readFile(join(fontDir, "PlusJakartaSans-Medium.ttf")),
	readFile(join(fontDir, "PlusJakartaSans-ExtraBold.ttf")),
	readFile(join(fontDir, "InstrumentSerif-Italic.ttf")),
	readFile(join(fontDir, "GeistMono-Medium.ttf")),
]);

async function loadFonts() {
	const [jakartaMedium, jakartaExtraBold, serifItalic, monoMedium] =
		await fontFiles;
	return [
		{ name: "Jakarta", data: jakartaMedium, weight: 500 as const },
		{ name: "Jakarta", data: jakartaExtraBold, weight: 800 as const },
		{
			name: "Serif",
			data: serifItalic,
			weight: 400 as const,
			style: "italic" as const,
		},
		{ name: "Mono", data: monoMedium, weight: 500 as const },
	];
}

const BARCODE = [3, 1, 2, 1, 4, 1, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1, 1, 4, 1, 2];

function Barcode({ color }: { color: string }) {
	return (
		<div style={{ display: "flex", alignItems: "stretch", height: 30, gap: 3 }}>
			{BARCODE.map((width, index) => (
				<div
					key={index}
					style={{ width, height: 30, background: color, display: "flex" }}
				/>
			))}
		</div>
	);
}

function Eyebrow({ children }: { children: ReactNode }) {
	return (
		<div
			style={{
				display: "flex",
				fontFamily: "Mono",
				fontSize: 17,
				letterSpacing: "0.2em",
				textTransform: "uppercase",
				color: FAINT,
			}}
		>
			{children}
		</div>
	);
}

async function renderCard({
	glow,
	children,
}: {
	glow: string;
	children: ReactNode;
}) {
	const fonts = await loadFonts();
	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				position: "relative",
				background: INK,
				backgroundImage: `radial-gradient(900px 520px at 88% -8%, ${glow}, transparent 62%), radial-gradient(760px 520px at -6% 112%, rgba(245,184,61,0.14), transparent 60%)`,
				color: PAPER,
				fontFamily: "Jakarta",
				padding: "56px 64px",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<div style={{ display: "flex", color: "#ffffff" }}>
					<LogoLockup style={{ width: 236, height: 36 }} />
				</div>
				<div
					style={{
						display: "flex",
						fontFamily: "Mono",
						fontSize: 18,
						color: MUTED,
					}}
				>
					llmgateway.io
				</div>
			</div>
			{children}
		</div>,
		{ ...ogSize, fonts },
	);
}

export async function homeOgImage() {
	return await renderCard({
		glow: "rgba(245,184,61,0.24)",
		children: (
			<div
				style={{
					display: "flex",
					flex: 1,
					alignItems: "center",
					justifyContent: "space-between",
					gap: 32,
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						width: 640,
						gap: 20,
					}}
				>
					<Eyebrow>Enterprise AI gateway</Eyebrow>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							fontSize: 62,
							fontWeight: 800,
							letterSpacing: "-0.045em",
							lineHeight: 1.02,
						}}
					>
						<span>Company-wide AI,</span>
						<span
							style={{
								fontFamily: "Serif",
								fontStyle: "italic",
								fontWeight: 400,
								letterSpacing: "-0.02em",
								color: AMBER,
								marginTop: 6,
							}}
						>
							live in weeks, not quarters.
						</span>
					</div>
					<div
						style={{
							display: "flex",
							fontSize: 23,
							lineHeight: 1.4,
							color: MUTED,
						}}
					>
						{`One OpenAI-compatible gateway to ${MARKETING_STATS.models} models from ${MARKETING_STATS.providers} providers. SSO, audit logs and guardrails on Enterprise.`}
					</div>
				</div>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						width: 396,
						borderRadius: 22,
						background: "#fffdf7",
						color: "#111113",
						padding: "26px 28px",
						boxShadow: "0 40px 90px -30px rgba(245,184,61,0.45)",
					}}
				>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							fontFamily: "Mono",
							fontSize: 13,
							letterSpacing: "0.18em",
							color: "rgba(17,17,19,0.5)",
						}}
					>
						<span>● BOARDING PASS</span>
						<span>ENTERPRISE PILOT</span>
					</div>
					<div
						style={{
							display: "flex",
							marginTop: 16,
							fontSize: 28,
							fontWeight: 800,
							letterSpacing: "-0.035em",
						}}
					>
						30-day production pilot
					</div>
					{[
						["WEEK 1", "Traffic live"],
						["WEEK 2", "Controls on"],
						["DAY 30", "You decide"],
					].map(([when, what]) => (
						<div
							key={when}
							style={{
								display: "flex",
								alignItems: "baseline",
								gap: 18,
								marginTop: 14,
							}}
						>
							<span
								style={{
									display: "flex",
									width: 78,
									fontFamily: "Mono",
									fontSize: 14,
									letterSpacing: "0.12em",
									color: "#b45309",
								}}
							>
								{when}
							</span>
							<span style={{ display: "flex", fontSize: 20 }}>{what}</span>
						</div>
					))}
					<div
						style={{
							display: "flex",
							marginTop: 22,
							borderTop: "2px dashed rgba(17,17,19,0.16)",
						}}
					/>
					<div
						style={{
							display: "flex",
							justifyContent: "center",
							marginTop: 20,
							padding: "14px 0",
							borderRadius: 999,
							background: AMBER,
							fontSize: 20,
							fontWeight: 800,
						}}
					>
						Start your 30-day pilot →
					</div>
				</div>
			</div>
		),
	});
}

export interface ProductOgOptions {
	gate: string;
	audience: string;
	title: string;
	titleAccent: string;
	subtitle: string;
	screenshot: string;
	accent: string;
	glow: string;
}

export async function productOgImage({
	gate,
	audience,
	title,
	titleAccent,
	subtitle,
	screenshot,
	accent,
	glow,
}: ProductOgOptions) {
	const image = await sharp(
		join(process.cwd(), "public/home/products", screenshot),
	)
		.png()
		.toBuffer();
	return await renderCard({
		glow,
		children: (
			<div style={{ display: "flex", flex: 1, flexDirection: "column" }}>
				<div
					style={{
						display: "flex",
						flex: 1,
						alignItems: "center",
						justifyContent: "space-between",
						gap: 36,
					}}
				>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							width: 470,
							gap: 20,
						}}
					>
						<Eyebrow>{audience}</Eyebrow>
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								fontSize: 60,
								fontWeight: 800,
								letterSpacing: "-0.045em",
								lineHeight: 1.04,
							}}
						>
							<span>{title}</span>
							<span
								style={{
									fontFamily: "Serif",
									fontStyle: "italic",
									fontWeight: 400,
									letterSpacing: "-0.02em",
									color: accent,
									marginTop: 4,
								}}
							>
								{titleAccent}
							</span>
						</div>
						<div
							style={{
								display: "flex",
								fontSize: 22,
								lineHeight: 1.42,
								color: MUTED,
							}}
						>
							{subtitle}
						</div>
					</div>
					<div
						style={{
							display: "flex",
							width: 560,
							height: 280,
							borderRadius: 16,
							overflow: "hidden",
							border: "1px solid rgba(255,255,255,0.14)",
							boxShadow: `0 40px 90px -30px ${glow}`,
						}}
					>
						<img
							src={`data:image/png;base64,${image.toString("base64")}`}
							width={560}
							height={280}
							alt=""
						/>
					</div>
				</div>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						paddingTop: 22,
						borderTop: "2px dashed rgba(244,241,232,0.16)",
					}}
				>
					<div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
						<span
							style={{
								fontFamily: "Serif",
								fontStyle: "italic",
								fontSize: 52,
								lineHeight: 1,
								color: accent,
							}}
						>
							{gate}
						</span>
						<span
							style={{
								fontFamily: "Mono",
								fontSize: 15,
								letterSpacing: "0.2em",
								color: FAINT,
							}}
						>
							GATE
						</span>
					</div>
					<Barcode color="rgba(244,241,232,0.5)" />
				</div>
			</div>
		),
	});
}
