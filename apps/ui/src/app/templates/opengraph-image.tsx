import { ImageResponse } from "next/og";

import Logo from "@/lib/icons/Logo";

export const size = {
	width: 1200,
	height: 630,
};
export const contentType = "image/png";

export default async function TemplatesOgImage() {
	return new ImageResponse(
		(
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
					alignItems: "center",
					background: "#000000",
					color: "white",
					fontFamily:
						"system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						gap: 40,
					}}
				>
					<div
						style={{
							width: 120,
							height: 120,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							color: "#ffffff",
						}}
					>
						<Logo style={{ width: 120, height: 120 }} />
					</div>
					<h1
						style={{
							fontSize: 96,
							fontWeight: 700,
							margin: 0,
							letterSpacing: "-0.03em",
							color: "#ffffff",
						}}
					>
						Templates
					</h1>
				</div>
			</div>
		),
		size,
	);
}
