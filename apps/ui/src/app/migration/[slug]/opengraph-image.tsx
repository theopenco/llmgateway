import { ImageResponse } from "next/og";

import type { Migration } from "content-collections";

export const size = {
	width: 1200,
	height: 630,
};
export const contentType = "image/png";

// OpenRouter Icon
const OpenRouterIcon = () => (
	<svg
		fill="#ffffff"
		fillRule="evenodd"
		viewBox="0 0 24 24"
		xmlns="http://www.w3.org/2000/svg"
		width={80}
		height={80}
	>
		<path d="m16.804 1.957 7.22 4.105v.087L16.73 10.21l.017-2.117-.821-.03c-1.059-.028-1.611.002-2.268.11-1.064.175-2.038.577-3.147 1.352L8.345 11.03c-.284.195-.495.336-.68.455l-.515.322-.397.234.385.23.53.338c.476.314 1.17.796 2.701 1.866 1.11.775 2.083 1.177 3.147 1.352l.3.045c.694.091 1.375.094 2.825.033l.022-2.159 7.22 4.105v.087L16.589 22l.014-1.862-.635.022c-1.386.042-2.137.002-3.138-.162-1.694-.28-3.26-.926-4.881-2.059l-2.158-1.5a21.997 21.997 0 0 0-.755-.498l-.467-.28a55.927 55.927 0 0 0-.76-.43C2.908 14.73.563 14.116 0 14.116V9.888l.14.004c.564-.007 2.91-.622 3.809-1.124l1.016-.58.438-.274c.428-.28 1.072-.726 2.686-1.853 1.621-1.133 3.186-1.78 4.881-2.059 1.152-.19 1.974-.213 3.814-.138z" />
	</svg>
);

// Vercel Icon
const VercelIcon = () => (
	<svg viewBox="0 0 76 65" fill="#ffffff" width={80} height={80}>
		<path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
	</svg>
);

// LiteLLM Icon (Train emoji as text)
const LiteLLMIcon = () => (
	<div
		style={{
			fontSize: 64,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
		}}
	>
		🚅
	</div>
);

// Portkey Icon
const PortkeyIcon = () => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		fill="none"
		viewBox="0 0 180 180"
		width={80}
		height={80}
	>
		<path
			fill="url(#portkey-og-gradient)"
			d="M109.063 7.5c14.782 0 28.37 7.992 35.766 20.851l23.12 40.191.346.614c7.159 12.942 7.078 28.784-.258 41.663l-23.179 40.68c-7.374 12.944-21.01 21.001-35.855 21.001H64.215c-14.95 0-28.669-8.17-36.004-21.26l-22.79-40.68c-7.256-12.951-7.227-28.838.082-41.759l22.738-40.19C35.598 15.604 49.266 7.5 64.156 7.5zM64.156 28.05c-7.392 0-14.312 4.021-18.088 10.696L23.33 78.936c-3.767 6.659-3.783 14.88-.044 21.556l22.797 40.687.178.314c3.803 6.531 10.647 10.457 17.953 10.457h44.788c7.37 0 14.274-3.997 18.057-10.639l23.173-40.681c3.842-6.743 3.825-15.098-.044-21.825l-23.113-40.197c-3.794-6.597-10.674-10.558-18.013-10.558zm25.44 22.11c4.268-3.54 10.597-3.037 14.256 1.172l25.171 28.956.223.263a14.81 14.81 0 0 1-.223 19.16l-25.171 28.957c-3.659 4.209-9.988 4.712-14.255 1.172l-.202-.172c-4.268-3.728-4.71-10.222-.991-14.499L110.284 90l-21.88-25.169c-3.718-4.277-3.277-10.771.99-14.5l.203-.17Z"
		/>
		<defs>
			<linearGradient
				id="portkey-og-gradient"
				x1="-92.51"
				x2="194.256"
				y1="52.188"
				y2="216.739"
				gradientUnits="userSpaceOnUse"
			>
				<stop offset=".173" stopColor="#00a3ff" />
				<stop offset=".899" stopColor="#ff0f00" />
			</linearGradient>
		</defs>
	</svg>
);

// GitHub Copilot Icon
const GitHubCopilotIcon = () => (
	<svg
		fill="#ffffff"
		fillRule="evenodd"
		viewBox="0 0 24 24"
		xmlns="http://www.w3.org/2000/svg"
		width={80}
		height={80}
	>
		<path d="M19.245 5.364c1.322 1.36 1.877 3.216 2.11 5.817.622 0 1.2.135 1.592.654l.73.964c.21.278.323.61.323.955v2.62c0 .339-.173.669-.453.868C20.239 19.602 16.157 21.5 12 21.5c-4.6 0-9.205-2.583-11.547-4.258-.28-.2-.452-.53-.453-.868v-2.62c0-.345.113-.679.321-.956l.73-.963c.392-.517.974-.654 1.593-.654l.029-.297c.25-2.446.81-4.213 2.082-5.52 2.461-2.54 5.71-2.851 7.146-2.864h.198c1.436.013 4.685.323 7.146 2.864m-7.244 4.328c-.284 0-.613.016-.962.05-.123.447-.305.85-.57 1.108-1.05 1.023-2.316 1.18-2.994 1.18-.638 0-1.306-.13-1.851-.464-.516.165-1.012.403-1.044.996a65.882 65.882 0 0 0-.063 2.884l-.002.48c-.002.563-.005 1.126-.013 1.69.002.326.204.63.51.765 2.482 1.102 4.83 1.657 6.99 1.657 2.156 0 4.504-.555 6.985-1.657a.854.854 0 0 0 .51-.766c.03-1.682.006-3.372-.076-5.053-.031-.596-.528-.83-1.046-.996-.546.333-1.212.464-1.85.464-.677 0-1.942-.157-2.993-1.18-.266-.258-.447-.661-.57-1.108-.32-.032-.64-.049-.96-.05zm-2.525 4.013c.539 0 .976.426.976.95v1.753c0 .525-.437.95-.976.95a.964.964 0 0 1-.976-.95v-1.752c0-.525.437-.951.976-.951m5 0c.539 0 .976.426.976.95v1.753c0 .525-.437.95-.976.95a.964.964 0 0 1-.976-.95v-1.752c0-.525.437-.951.976-.951M7.635 5.087c-1.05.102-1.935.438-2.385.906-.975 1.037-.765 3.668-.21 4.224.405.394 1.17.657 1.995.657h.09c.649-.013 1.785-.176 2.73-1.11.435-.41.705-1.433.675-2.47-.03-.834-.27-1.52-.63-1.813-.39-.336-1.275-.482-2.265-.394m6.465.394c-.36.292-.6.98-.63 1.813-.03 1.037.24 2.06.675 2.47.968.957 2.136 1.104 2.776 1.11h.044c.825 0 1.59-.263 1.995-.657.555-.556.765-3.187-.21-4.224-.45-.468-1.335-.804-2.385-.906-.99-.088-1.875.058-2.265.394M12 7.615c-.24 0-.525.015-.84.044.03.16.045.336.06.526l-.001.159a2.94 2.94 0 0 1-.014.25c.225-.022.425-.027.612-.028h.366c.187 0 .387.006.612.028-.015-.146-.015-.277-.015-.409.015-.19.03-.365.06-.526a9.29 9.29 0 0 0-.84-.044" />
	</svg>
);

// Generic fallback icon for providers without a dedicated logo
const GenericProviderIcon = () => (
	<svg
		viewBox="0 0 24 24"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		width={80}
		height={80}
	>
		<path
			d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
			stroke="#ffffff"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

// Arrow Icon for migration
const ArrowIcon = () => (
	<svg
		viewBox="0 0 24 24"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		width={48}
		height={48}
	>
		<path
			d="M5 12h14M12 5l7 7-7 7"
			stroke="#9CA3AF"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

// LLM Gateway Icon
const LLMGatewayIcon = () => (
	<svg
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 218 232"
		width={80}
		height={80}
	>
		<path
			d="M218 59.4686c0-4.1697-2.351-7.9813-6.071-9.8441L119.973 3.58361s2.926 3.32316 2.926 7.01529V218.833c0 4.081-2.926 7.016-2.926 7.016l15.24-7.468c2.964-2.232 7.187-7.443 7.438-16.006.293-9.976.61-84.847.732-121.0353.487-3.6678 4.096-11.0032 14.63-11.0032 10.535 0 29.262 5.1348 37.309 7.7022 2.439.7336 7.608 4.1812 8.779 12.1036 1.17 7.9223.975 59.0507.731 83.6247 0 2.445.137 7.069 6.653 7.069 6.515 0 6.515-7.069 6.515-7.069V59.4686Z"
			fill="#ffffff"
		/>
		<path
			d="M149.235 86.323c0-5.5921 5.132-9.7668 10.589-8.6132l31.457 6.6495c4.061.8585 6.967 4.4207 6.967 8.5824v81.9253c0 5.868 5.121 9.169 5.121 9.169l-51.9-12.658c-1.311-.32-2.234-1.498-2.234-2.852V86.323ZM99.7535 1.15076c7.2925-3.60996 15.8305 1.71119 15.8305 9.86634V220.983c0 8.155-8.538 13.476-15.8305 9.866L6.11596 184.496C2.37105 182.642 0 178.818 0 174.63v-17.868l49.7128 19.865c4.0474 1.617 8.4447-1.372 8.4449-5.741 0-2.66-1.6975-5.022-4.2142-5.863L0 146.992v-14.305l40.2756 7.708c3.9656.759 7.6405-2.289 7.6405-6.337 0-3.286-2.4628-6.048-5.7195-6.413L0 122.917V108.48l78.5181-3.014c4.1532-.16 7.4381-3.582 7.4383-7.7498 0-4.6256-4.0122-8.2229-8.5964-7.7073L0 98.7098V82.4399l53.447-17.8738c2.3764-.7948 3.9791-3.0254 3.9792-5.5374 0-4.0961-4.0978-6.9185-7.9106-5.4486L0 72.6695V57.3696c.0000304-4.1878 2.37107-8.0125 6.11596-9.8664L99.7535 1.15076Z"
			fill="#ffffff"
		/>
	</svg>
);

// Map provider names to their icons
function getIconForProvider(provider: string) {
	const iconMap: Record<string, () => React.JSX.Element> = {
		OpenRouter: OpenRouterIcon,
		"Vercel AI Gateway": VercelIcon,
		LiteLLM: LiteLLMIcon,
		Portkey: PortkeyIcon,
		"GitHub Copilot": GitHubCopilotIcon,
	};

	return iconMap[provider] || GenericProviderIcon;
}

export default async function MigrationOgImage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { allMigrations } = await import("content-collections");
	const { slug } = await params;

	const migration = allMigrations.find(
		(migration: Migration) => migration.slug === slug,
	);

	if (!migration) {
		return new ImageResponse(
			(
				<div
					style={{
						width: "100%",
						height: "100%",
						display: "flex",
						background: "#000000",
					}}
				/>
			),
			size,
		);
	}

	const ProviderIcon = getIconForProvider(migration.fromProvider);

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
					<svg
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 218 232"
						width={48}
						height={48}
					>
						<path
							d="M218 59.4686c0-4.1697-2.351-7.9813-6.071-9.8441L119.973 3.58361s2.926 3.32316 2.926 7.01529V218.833c0 4.081-2.926 7.016-2.926 7.016l15.24-7.468c2.964-2.232 7.187-7.443 7.438-16.006.293-9.976.61-84.847.732-121.0353.487-3.6678 4.096-11.0032 14.63-11.0032 10.535 0 29.262 5.1348 37.309 7.7022 2.439.7336 7.608 4.1812 8.779 12.1036 1.17 7.9223.975 59.0507.731 83.6247 0 2.445.137 7.069 6.653 7.069 6.515 0 6.515-7.069 6.515-7.069V59.4686Z"
							fill="#ffffff"
						/>
						<path
							d="M149.235 86.323c0-5.5921 5.132-9.7668 10.589-8.6132l31.457 6.6495c4.061.8585 6.967 4.4207 6.967 8.5824v81.9253c0 5.868 5.121 9.169 5.121 9.169l-51.9-12.658c-1.311-.32-2.234-1.498-2.234-2.852V86.323ZM99.7535 1.15076c7.2925-3.60996 15.8305 1.71119 15.8305 9.86634V220.983c0 8.155-8.538 13.476-15.8305 9.866L6.11596 184.496C2.37105 182.642 0 178.818 0 174.63v-17.868l49.7128 19.865c4.0474 1.617 8.4447-1.372 8.4449-5.741 0-2.66-1.6975-5.022-4.2142-5.863L0 146.992v-14.305l40.2756 7.708c3.9656.759 7.6405-2.289 7.6405-6.337 0-3.286-2.4628-6.048-5.7195-6.413L0 122.917V108.48l78.5181-3.014c4.1532-.16 7.4381-3.582 7.4383-7.7498 0-4.6256-4.0122-8.2229-8.5964-7.7073L0 98.7098V82.4399l53.447-17.8738c2.3764-.7948 3.9791-3.0254 3.9792-5.5374 0-4.0961-4.0978-6.9185-7.9106-5.4486L0 72.6695V57.3696c.0000304-4.1878 2.37107-8.0125 6.11596-9.8664L99.7535 1.15076Z"
							fill="#ffffff"
						/>
					</svg>
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
						<span>Migration Guide</span>
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
					{/* Migration icons */}
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							alignItems: "center",
							gap: 32,
						}}
					>
						{/* From provider icon */}
						<div
							style={{
								width: 120,
								height: 120,
								borderRadius: 20,
								backgroundColor: "#1a1a1a",
								border: "2px solid rgba(255,255,255,0.1)",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								padding: 16,
							}}
						>
							<ProviderIcon />
						</div>

						{/* Arrow */}
						<ArrowIcon />

						{/* LLM Gateway icon */}
						<div
							style={{
								width: 120,
								height: 120,
								borderRadius: 20,
								backgroundColor: "#1a1a1a",
								border: "2px solid rgba(59,130,246,0.5)",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								padding: 16,
							}}
						>
							<LLMGatewayIcon />
						</div>
					</div>

					{/* Title and description */}
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							gap: 24,
							maxWidth: 1000,
						}}
					>
						<h1
							style={{
								fontSize: 64,
								fontWeight: 700,
								margin: 0,
								letterSpacing: "-0.03em",
								textAlign: "center",
								lineHeight: 1.1,
							}}
						>
							{migration.title}
						</h1>
						<p
							style={{
								fontSize: 28,
								color: "#9CA3AF",
								margin: 0,
								textAlign: "center",
								lineHeight: 1.3,
							}}
						>
							{migration.description}
						</p>
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
