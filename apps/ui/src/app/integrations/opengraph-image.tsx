import { ImageResponse } from "next/og";

import Logo from "@/lib/icons/Logo";

export const size = {
	width: 1200,
	height: 630,
};
export const contentType = "image/png";

// Anthropic Icon (coral/salmon brand color)
const AnthropicIcon = () => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		shapeRendering="geometricPrecision"
		textRendering="geometricPrecision"
		imageRendering="optimizeQuality"
		fillRule="evenodd"
		clipRule="evenodd"
		viewBox="0 0 512 509.64"
		width={64}
		height={64}
	>
		<path
			fill="#D77655"
			d="M115.612 0h280.775C459.974 0 512 52.026 512 115.612v278.415c0 63.587-52.026 115.612-115.613 115.612H115.612C52.026 509.639 0 457.614 0 394.027V115.612C0 52.026 52.026 0 115.612 0z"
		/>
		<path
			fill="#FCF2EE"
			fillRule="nonzero"
			d="m142.27 316.619 73.655-41.326 1.238-3.589-1.238-1.996-3.589-.001-12.31-.759-42.084-1.138-36.498-1.516-35.361-1.896-8.897-1.895-8.34-10.995.859-5.484 7.482-5.03 10.717.935 23.683 1.617 35.537 2.452 25.782 1.517 38.193 3.968h6.064l.86-2.451-2.073-1.517-1.618-1.517-36.776-24.922-39.81-26.338-20.852-15.166-11.273-7.683-5.687-7.204-2.451-15.721 10.237-11.273 13.75.935 3.513.936 13.928 10.716 29.749 23.027 38.848 28.612 5.687 4.727 2.275-1.617.278-1.138-2.553-4.271-21.13-38.193-22.546-38.848-10.035-16.101-2.654-9.655c-.935-3.968-1.617-7.304-1.617-11.374l11.652-15.823 6.445-2.073 15.545 2.073 6.547 5.687 9.655 22.092 15.646 34.78 24.265 47.291 7.103 14.028 3.791 12.992 1.416 3.968 2.449-.001v-2.275l1.997-26.641 3.69-32.707 3.589-42.084 1.239-11.854 5.863-14.206 11.652-7.683 9.099 4.348 7.482 10.716-1.036 6.926-4.449 28.915-8.72 45.294-5.687 30.331h3.313l3.792-3.791 15.342-20.372 25.782-32.227 11.374-12.789 13.27-14.129 8.517-6.724 16.1-.001 11.854 17.617-5.307 18.199-16.581 21.029-13.75 17.819-19.716 26.54-12.309 21.231 1.138 1.694 2.932-.278 44.536-9.479 24.062-4.347 28.714-4.928 12.992 6.066 1.416 6.167-5.106 12.613-30.71 7.583-36.018 7.204-53.636 12.689-.657.48.758.935 24.164 2.275 10.337.556h25.301l47.114 3.514 12.309 8.139 7.381 9.959-1.238 7.583-18.957 9.655-25.579-6.066-59.702-14.205-20.474-5.106-2.83-.001v1.694l17.061 16.682 31.266 28.233 39.152 36.397 1.997 8.999-5.03 7.102-5.307-.758-34.401-25.883-13.27-11.651-30.053-25.302-1.996-.001v2.654l6.926 10.136 36.574 54.975 1.895 16.859-2.653 5.485-9.479 3.311-10.414-1.895-21.408-30.054-22.092-33.844-17.819-30.331-2.173 1.238-10.515 113.261-4.929 5.788-11.374 4.348-9.478-7.204-5.03-11.652 5.03-23.027 6.066-30.052 4.928-23.886 4.449-29.674 2.654-9.858-.177-.657-2.173.278-22.37 30.71-34.021 45.977-26.919 28.815-6.445 2.553-11.173-5.789 1.037-10.337 6.243-9.2 37.257-47.392 22.47-29.371 14.508-16.961-.101-2.451h-.859l-98.954 64.251-17.618 2.275-7.583-7.103.936-11.652 3.589-3.791 29.749-20.474-.101.102.024.101z"
		/>
	</svg>
);

// Cursor Icon
const CursorIcon = () => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 466.73 532.09"
		width={64}
		height={64}
	>
		<path
			d="M457.43 125.94 244.42 2.96c-6.84-3.95-15.28-3.95-22.12 0L9.3 125.94C3.55 129.26 0 135.4 0 142.05v247.99c0 6.65 3.55 12.79 9.3 16.11l213.01 122.98c6.84 3.95 15.28 3.95 22.12 0l213.01-122.98c5.75-3.32 9.3-9.46 9.3-16.11V142.05c0-6.65-3.55-12.79-9.3-16.11zm-13.38 26.05L238.42 508.15c-1.39 2.4-5.06 1.42-5.06-1.36V273.58c0-4.66-2.49-8.97-6.53-11.31L24.87 145.67c-2.4-1.39-1.42-5.06 1.36-5.06h411.26c5.84 0 9.49 6.33 6.57 11.39h-.01Z"
			fill="#ffffff"
		/>
	</svg>
);

// Cline Icon
const ClineIcon = () => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 466.73 487.04"
		width={64}
		height={64}
	>
		<path
			d="m463.6 275.08-29.26-58.75V182.5c0-56.08-45.01-101.5-100.53-101.5H283.8c3.62-7.43 5.61-15.79 5.61-24.61C289.41 25.22 264.33 0 233.34 0s-56.07 25.22-56.07 56.39c0 8.82 1.99 17.17 5.61 24.61h-50.01C77.36 81 32.35 126.42 32.35 182.5v33.83L2.48 274.92c-3.01 5.9-3.01 12.92 0 18.81l29.87 57.93v33.83c0 56.08 45.01 101.5 100.52 101.5h200.95c55.51 0 100.53-45.42 100.53-101.5v-33.83l29.21-58.13c2.9-5.79 2.9-12.61.05-18.46Zm-260.85 47.88c0 25.48-20.54 46.14-45.88 46.14s-45.88-20.66-45.88-46.14v-82.02c0-25.48 20.54-46.14 45.88-46.14s45.88 20.66 45.88 46.14zm147.83 0c0 25.48-20.54 46.14-45.88 46.14s-45.88-20.66-45.88-46.14v-82.02c0-25.48 20.54-46.14 45.88-46.14s45.88 20.66 45.88 46.14z"
			fill="#ffffff"
		/>
	</svg>
);

// N8N Icon
const N8nIcon = () => (
	<svg
		viewBox="0 0 24 24"
		xmlns="http://www.w3.org/2000/svg"
		width={64}
		height={64}
	>
		<path
			clipRule="evenodd"
			d="M24 8.4c0 1.325-1.102 2.4-2.462 2.4-1.146 0-2.11-.765-2.384-1.8h-3.436c-.602 0-1.115.424-1.214 1.003l-.101.592a2.38 2.38 0 0 1-.8 1.405c.412.354.704.844.8 1.405l.1.592A1.222 1.222 0 0 0 15.719 15h.975c.273-1.035 1.237-1.8 2.384-1.8 1.36 0 2.461 1.075 2.461 2.4S20.436 18 19.078 18c-1.147 0-2.11-.765-2.384-1.8h-.975c-1.204 0-2.23-.848-2.428-2.005l-.101-.592a1.222 1.222 0 0 0-1.214-1.003H10.97c-.308.984-1.246 1.7-2.356 1.7-1.11 0-2.048-.716-2.355-1.7H4.817c-.308.984-1.246 1.7-2.355 1.7C1.102 14.3 0 13.225 0 11.9s1.102-2.4 2.462-2.4c1.183 0 2.172.815 2.408 1.9h1.337c.236-1.085 1.225-1.9 2.408-1.9 1.184 0 2.172.815 2.408 1.9h.952c.601 0 1.115-.424 1.213-1.003l.102-.592c.198-1.157 1.225-2.005 2.428-2.005h3.436c.274-1.035 1.238-1.8 2.384-1.8C22.898 6 24 7.075 24 8.4zm-1.23 0c0 .663-.552 1.2-1.232 1.2-.68 0-1.23-.537-1.23-1.2 0-.663.55-1.2 1.23-1.2.68 0 1.231.537 1.231 1.2zM2.461 13.1c.68 0 1.23-.537 1.23-1.2 0-.663-.55-1.2-1.23-1.2-.68 0-1.231.537-1.231 1.2 0 .663.55 1.2 1.23 1.2zm6.153 0c.68 0 1.231-.537 1.231-1.2 0-.663-.55-1.2-1.23-1.2-.68 0-1.231.537-1.231 1.2 0 .663.55 1.2 1.23 1.2zm10.462 3.7c.68 0 1.23-.537 1.23-1.2 0-.663-.55-1.2-1.23-1.2-.68 0-1.23.537-1.23 1.2 0 .663.55 1.2 1.23 1.2z"
			fill="#EA4B71"
			fillRule="evenodd"
		/>
	</svg>
);

// OpenCode Icon
const OpenCodeIcon = () => (
	<svg
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 240 300"
		width={64}
		height={64}
	>
		<path d="M180 240H60V120h120z" fill="#888888" />
		<path d="M180 60H60v180h120zm60 240H0V0h240z" fill="#ffffff" />
	</svg>
);

// VS Code Icon
const VSCodeIcon = () => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 24 24"
		width={64}
		height={64}
	>
		<path
			d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"
			fill="#007ACC"
		/>
	</svg>
);

export default async function IntegrationsOgImage() {
	return new ImageResponse(
		(
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
					fontFamily:
						"system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
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
						<span style={{ color: "#ffffff", fontWeight: 600 }}>
							LLM Gateway
						</span>
						<span style={{ opacity: 0.6 }}>•</span>
						<span>Integrations</span>
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
						gap: 48,
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
							Integrations
						</h1>
						<p
							style={{
								fontSize: 28,
								color: "#9CA3AF",
								margin: 0,
								textAlign: "center",
							}}
						>
							Connect with your favorite AI tools
						</p>
					</div>

					{/* Integration icons */}
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							alignItems: "center",
							justifyContent: "center",
							gap: 32,
						}}
					>
						<div
							style={{
								width: 88,
								height: 88,
								borderRadius: 16,
								backgroundColor: "#1a1a1a",
								border: "1px solid rgba(255,255,255,0.1)",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							<AnthropicIcon />
						</div>
						<div
							style={{
								width: 88,
								height: 88,
								borderRadius: 16,
								backgroundColor: "#1a1a1a",
								border: "1px solid rgba(255,255,255,0.1)",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							<CursorIcon />
						</div>
						<div
							style={{
								width: 88,
								height: 88,
								borderRadius: 16,
								backgroundColor: "#1a1a1a",
								border: "1px solid rgba(255,255,255,0.1)",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							<ClineIcon />
						</div>
						<div
							style={{
								width: 88,
								height: 88,
								borderRadius: 16,
								backgroundColor: "#1a1a1a",
								border: "1px solid rgba(255,255,255,0.1)",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							<N8nIcon />
						</div>
						<div
							style={{
								width: 88,
								height: 88,
								borderRadius: 16,
								backgroundColor: "#1a1a1a",
								border: "1px solid rgba(255,255,255,0.1)",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							<OpenCodeIcon />
						</div>
						<div
							style={{
								width: 88,
								height: 88,
								borderRadius: 16,
								backgroundColor: "#1a1a1a",
								border: "1px solid rgba(255,255,255,0.1)",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							<VSCodeIcon />
						</div>
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
			</div>
		),
		size,
	);
}
