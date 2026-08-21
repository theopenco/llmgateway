import { ImageResponse } from "next/og";

import {
	AwsBedrockOgIcon,
	AzureOgIcon,
	GitHubCopilotOgIcon,
	LiteLLMOgIcon,
	LLMGatewayOgIcon,
	OpenRouterOgIcon,
	PortkeyOgIcon,
	VercelOgIcon,
} from "./og-icons";

export const size = {
	width: 1200,
	height: 630,
};
export const contentType = "image/png";
export const alt = "LLM Gateway compared to every major AI gateway";

const COMPETITORS = [
	{ key: "open-router", Icon: OpenRouterOgIcon, iconSize: 52 },
	{ key: "portkey", Icon: PortkeyOgIcon, iconSize: 52 },
	{ key: "litellm", Icon: LiteLLMOgIcon, iconSize: 42 },
	{ key: "vercel-ai-gateway", Icon: VercelOgIcon, iconSize: 46 },
	{ key: "aws-bedrock", Icon: AwsBedrockOgIcon, iconSize: 60 },
	{ key: "azure-ai-foundry", Icon: AzureOgIcon, iconSize: 50 },
	{ key: "github-copilot", Icon: GitHubCopilotOgIcon, iconSize: 52 },
];

export default async function CompareHubOgImage() {
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
				<LLMGatewayOgIcon size={48} />
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
					<span>Comparisons</span>
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
					gap: 44,
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						gap: 20,
					}}
				>
					<h1
						style={{
							fontSize: 68,
							fontWeight: 700,
							margin: 0,
							letterSpacing: "-0.03em",
							textAlign: "center",
							lineHeight: 1.1,
						}}
					>
						Compare LLM Gateway
					</h1>
					<p
						style={{
							fontSize: 28,
							color: "#9CA3AF",
							margin: 0,
							textAlign: "center",
							lineHeight: 1.3,
							maxWidth: 900,
						}}
					>
						Side-by-side breakdowns against every major AI gateway, cloud model
						platform, and coding assistant
					</p>
				</div>

				{/* Competitor marks */}
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						justifyContent: "center",
						gap: 18,
					}}
				>
					<div
						style={{
							width: 94,
							height: 94,
							borderRadius: 18,
							backgroundColor: "#1a1a1a",
							border: "2px solid rgba(59,130,246,0.5)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
						}}
					>
						<LLMGatewayOgIcon size={54} />
					</div>
					<span
						style={{
							fontSize: 30,
							fontWeight: 700,
							color: "#9CA3AF",
							letterSpacing: "0.05em",
						}}
					>
						VS
					</span>
					{COMPETITORS.map(({ key, Icon, iconSize }) => (
						<div
							key={key}
							style={{
								width: 94,
								height: 94,
								borderRadius: 18,
								backgroundColor: "#1a1a1a",
								border: "1px solid rgba(255,255,255,0.1)",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							<Icon size={iconSize} />
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
