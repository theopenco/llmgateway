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

const CODE_STRING = "#fde68a";
const CODE_KEYWORD = "#c4b5fd";
const CODE_DIM = "rgba(244,241,232,0.5)";

type CodeToken = [text: string, color?: string];

const HOME_SNIPPET: CodeToken[][] = [
	[
		["const ", CODE_KEYWORD],
		["client = "],
		["new ", CODE_KEYWORD],
		["OpenAI({"],
	],
	[["  baseURL: "], ['"https://api.llmgateway.io/v1"', CODE_STRING], [","]],
	[["  apiKey: "], ["process.env.LLM_GATEWAY_API_KEY"], [","]],
	[["});"]],
	[[""]],
	[["await ", CODE_KEYWORD], ["client.chat.completions.create({"]],
	[
		["  model: "],
		['"claude-sonnet-5"', AMBER],
		[","],
		[`  // any of ${MARKETING_STATS.models}`, CODE_DIM],
	],
	[["  messages,"]],
	[["});"]],
];

// Catalogue ids for the providers named in the headline.
const HOME_MODELS = ["gpt-5.5", "claude-sonnet-5", "gemini-3.1-pro-preview"];

function CodeLine({ tokens }: { tokens: CodeToken[] }) {
	return (
		<div style={{ display: "flex", height: 24 }}>
			{tokens.map(([text, color], index) => (
				<span
					key={index}
					style={{ whiteSpace: "pre", color: color ?? PAPER, display: "flex" }}
				>
					{text}
				</span>
			))}
		</div>
	);
}

const HOME_STATS = [
	[MARKETING_STATS.tokensRouted, "tokens routed"],
	[MARKETING_STATS.requestsRouted, "requests routed"],
	[MARKETING_STATS.models, "models"],
	[MARKETING_STATS.providers, "providers"],
];

export async function homeOgImage() {
	return await renderCard({
		glow: "rgba(245,184,61,0.24)",
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
							width: 556,
							gap: 16,
						}}
					>
						<Eyebrow>Open-source LLM API gateway</Eyebrow>
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								fontSize: 46,
								fontWeight: 800,
								letterSpacing: "-0.045em",
								lineHeight: 1.04,
							}}
						>
							<span>{`One API for ${MARKETING_STATS.providers} providers.`}</span>
							<span
								style={{
									fontFamily: "Serif",
									fontStyle: "italic",
									fontWeight: 400,
									letterSpacing: "-0.02em",
									color: AMBER,
									marginTop: 4,
								}}
							>
								OpenAI, Anthropic, Google &amp; more.
							</span>
						</div>
						<div
							style={{
								display: "flex",
								fontSize: 20,
								lineHeight: 1.42,
								color: MUTED,
							}}
						>
							{`Route ${MARKETING_STATS.models} models, track costs in real time and switch providers without changing your code.`}
						</div>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 18,
								marginTop: 6,
							}}
						>
							<div
								style={{
									display: "flex",
									padding: "12px 22px",
									borderRadius: 999,
									background: AMBER,
									color: INK,
									fontSize: 19,
									fontWeight: 800,
								}}
							>
								Get my API key →
							</div>
							<div
								style={{
									display: "flex",
									fontFamily: "Mono",
									fontSize: 14,
									letterSpacing: "0.08em",
									color: FAINT,
								}}
							>
								FREE WITH YOUR OWN KEYS · NO CARD
							</div>
						</div>
					</div>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							width: 480,
							borderRadius: 18,
							background: "rgba(255,255,255,0.04)",
							border: "1px solid rgba(255,255,255,0.14)",
							boxShadow: "0 40px 90px -30px rgba(245,184,61,0.45)",
							padding: "20px 24px 22px",
							fontFamily: "Mono",
							fontSize: 14,
						}}
					>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								fontSize: 12,
								letterSpacing: "0.18em",
								color: FAINT,
								marginBottom: 16,
							}}
						>
							<span>● OPENAI-COMPATIBLE</span>
							<span>main.ts</span>
						</div>
						{HOME_SNIPPET.map((tokens, index) => (
							<CodeLine key={index} tokens={tokens} />
						))}
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 8,
								marginTop: 18,
								paddingTop: 16,
								borderTop: "1px dashed rgba(244,241,232,0.16)",
							}}
						>
							{HOME_MODELS.map((model) => {
								const active = model === "claude-sonnet-5";
								return (
									<span
										key={model}
										style={{
											display: "flex",
											flexShrink: 0,
											whiteSpace: "nowrap",
											padding: "5px 11px",
											borderRadius: 999,
											fontSize: 12,
											border: `1px solid ${active ? AMBER : "rgba(244,241,232,0.18)"}`,
											background: active
												? "rgba(252,211,77,0.14)"
												: "transparent",
											color: active ? AMBER : CODE_DIM,
										}}
									>
										{model}
									</span>
								);
							})}
						</div>
					</div>
				</div>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						paddingTop: 22,
						borderTop: "2px dashed rgba(244,241,232,0.16)",
					}}
				>
					{HOME_STATS.map(([value, label]) => (
						<div
							key={label}
							style={{ display: "flex", alignItems: "baseline", gap: 12 }}
						>
							<span
								style={{
									display: "flex",
									fontSize: 34,
									fontWeight: 800,
									letterSpacing: "-0.04em",
								}}
							>
								{value}
							</span>
							<span
								style={{
									display: "flex",
									fontFamily: "Mono",
									fontSize: 13,
									letterSpacing: "0.18em",
									textTransform: "uppercase",
									color: FAINT,
								}}
							>
								{label}
							</span>
						</div>
					))}
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
