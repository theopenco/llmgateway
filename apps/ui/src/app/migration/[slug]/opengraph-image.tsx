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
	};

	return iconMap[provider] || OpenRouterIcon;
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
