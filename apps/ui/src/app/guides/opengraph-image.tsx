import { ImageResponse } from "next/og";

import Logo from "@/lib/icons/Logo";

import {
	AnthropicIcon,
	AutohandIcon,
	ClineIcon,
	CodexCliIcon,
	ContinueIcon,
	CursorIcon,
	DevPassCodeIcon,
	HermesIcon,
	KiloCodeIcon,
	KimiIcon,
	McpIcon,
	MimoCodeIcon,
	N8nIcon,
	OpenClawIcon,
	OpenCodeIcon,
	PiIcon,
} from "./og-icons";

export const size = {
	width: 1200,
	height: 630,
};
export const contentType = "image/png";

const AGENT_ROWS = [
	[
		{ key: "claude-code", Icon: AnthropicIcon },
		{ key: "codex-cli", Icon: CodexCliIcon },
		{ key: "cursor", Icon: CursorIcon },
		{ key: "cline", Icon: ClineIcon },
		{ key: "opencode", Icon: OpenCodeIcon },
		{ key: "devpass-code", Icon: DevPassCodeIcon },
		{ key: "kilo-code", Icon: KiloCodeIcon },
		{ key: "kimi-code", Icon: KimiIcon },
	],
	[
		{ key: "autohand", Icon: AutohandIcon },
		{ key: "openclaw", Icon: OpenClawIcon },
		{ key: "continue", Icon: ContinueIcon },
		{ key: "pi", Icon: PiIcon },
		{ key: "mimocode", Icon: MimoCodeIcon },
		{ key: "hermes-agent", Icon: HermesIcon },
		{ key: "n8n", Icon: N8nIcon },
		{ key: "mcp", Icon: McpIcon },
	],
];

export default async function GuidesOgImage() {
	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				alignItems: "stretch",
				background: "#000000",
				color: "white",
				fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
				padding: 60,
				boxSizing: "border-box",
			}}
		>
			{/* Header with logo */}
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					alignItems: "center",
					gap: 16,
				}}
			>
				<div
					style={{
						width: 48,
						height: 48,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						color: "#ffffff",
					}}
				>
					<Logo style={{ width: 48, height: 48 }} />
				</div>
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						gap: 8,
						fontSize: 24,
						color: "#9CA3AF",
					}}
				>
					<span style={{ color: "#ffffff", fontWeight: 600 }}>LLM Gateway</span>
					<span style={{ opacity: 0.6 }}>•</span>
					<span>Guides</span>
				</div>
			</div>

			{/* Main content */}
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					flex: 1,
					gap: 40,
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						gap: 16,
					}}
				>
					<h1
						style={{
							fontSize: 72,
							fontWeight: 700,
							margin: 0,
							letterSpacing: "-0.02em",
						}}
					>
						Guides
					</h1>
					<p
						style={{
							fontSize: 28,
							color: "#9CA3AF",
							margin: 0,
							textAlign: "center",
						}}
					>
						Step-by-step tutorials for your favorite coding agents and tools
					</p>
				</div>

				{/* Coding agent icons */}
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						gap: 18,
					}}
				>
					{AGENT_ROWS.map((row, rowIndex) => (
						<div
							key={rowIndex}
							style={{
								display: "flex",
								flexDirection: "row",
								alignItems: "center",
								justifyContent: "center",
								gap: 18,
							}}
						>
							{row.map(({ key, Icon }) => (
								<div
									key={key}
									style={{
										width: 78,
										height: 78,
										borderRadius: 16,
										backgroundColor: "#1a1a1a",
										border: "1px solid rgba(255,255,255,0.1)",
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
									}}
								>
									<Icon size={52} />
								</div>
							))}
						</div>
					))}
				</div>
			</div>

			{/* Footer */}
			<div
				style={{
					display: "flex",
					flexDirection: "row",
					justifyContent: "flex-end",
					fontSize: 20,
					color: "#9CA3AF",
				}}
			>
				<span>llmgateway.io</span>
			</div>
		</div>,
		size,
	);
}
