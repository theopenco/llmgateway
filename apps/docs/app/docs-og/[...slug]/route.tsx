import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { notFound } from "next/navigation";
import { ImageResponse } from "next/og";

import { Logo } from "@/components/logo";
import { productForPath, sectionForPath } from "@/lib/products";
import { source } from "@/lib/source";

const imagePatterns = [
	/(?:basePath|screenshot)="([^"]+)"/,
	/!\[[^\]]*\]\((\/[^)\s]+\.(?:png|jpe?g|webp))\)/,
	/^image:\s*(\S+\.(?:png|jpe?g|webp))\s*$/m,
];

async function loadScreenshot(raw: string): Promise<string | null> {
	for (const pattern of imagePatterns) {
		const match = pattern.exec(raw)?.[1];
		if (!match) {
			continue;
		}
		const file = extname(match) ? match : `${match}-dark.png`;
		try {
			const data = await readFile(
				join(process.cwd(), "public", file.replace(/^\//, "")),
			);
			const type =
				extname(file) === ".png"
					? "png"
					: extname(file) === ".webp"
						? "webp"
						: "jpeg";
			return `data:image/${type};base64,${data.toString("base64")}`;
		} catch {
			return null;
		}
	}
	return null;
}

export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ slug: string[] }> },
) {
	const { slug } = await params;
	const page = source.getPage(slug.slice(0, -1));
	if (!page) {
		notFound();
	}

	const product = productForPath(page.path);
	const section = sectionForPath(page.path);
	const screenshot = await loadScreenshot(await page.data.getText("raw"));
	const path = page.url === "/" ? "" : page.url;
	const title = page.data.title;
	const titleSize = title.length > 48 ? 54 : title.length > 28 ? 64 : 76;

	return new ImageResponse(
		<div
			style={{
				display: "flex",
				position: "relative",
				width: "100%",
				height: "100%",
				backgroundColor: "#09090b",
				color: "#fafafa",
				overflow: "hidden",
			}}
		>
			<div
				style={{
					display: "flex",
					position: "absolute",
					inset: 0,
					backgroundImage:
						"linear-gradient(#ffffff0a 1px, transparent 1px), linear-gradient(90deg, #ffffff0a 1px, transparent 1px)",
					backgroundSize: "48px 48px",
				}}
			/>
			<div
				style={{
					display: "flex",
					position: "absolute",
					top: -360,
					right: -340,
					width: 900,
					height: 900,
					borderRadius: 9999,
					backgroundColor: `${product.accent}08`,
					border: `1px solid ${product.accent}1a`,
				}}
			/>
			<div
				style={{
					display: "flex",
					position: "absolute",
					top: -210,
					right: -190,
					width: 600,
					height: 600,
					borderRadius: 9999,
					backgroundColor: `${product.accent}0c`,
					border: `1px solid ${product.accent}26`,
				}}
			/>
			<div
				style={{
					display: "flex",
					position: "absolute",
					top: -70,
					right: -50,
					width: 320,
					height: 320,
					borderRadius: 9999,
					backgroundColor: `${product.accent}14`,
					border: `1px solid ${product.accent}33`,
				}}
			/>
			<div
				style={{
					display: "flex",
					position: "absolute",
					left: 0,
					top: 0,
					bottom: 0,
					width: 8,
					backgroundColor: product.accent,
				}}
			/>
			{screenshot ? (
				<div
					style={{
						display: "flex",
						position: "absolute",
						right: -90,
						top: 170,
						width: 560,
						height: 350,
						borderRadius: 18,
						border: "1px solid #ffffff26",
						boxShadow: `0 30px 80px #000000cc, 0 0 0 8px ${product.accent}22`,
						overflow: "hidden",
						backgroundColor: "#18181b",
					}}
				>
					<img
						src={screenshot}
						width={560}
						height={350}
						style={{ objectFit: "cover", objectPosition: "top left" }}
					/>
				</div>
			) : null}
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					justifyContent: "space-between",
					width: "100%",
					height: "100%",
					padding: "56px 64px 52px 72px",
				}}
			>
				<div style={{ display: "flex", alignItems: "center" }}>
					<Logo width={40} height={42} style={{ color: "#fafafa" }} />
					<div
						style={{
							display: "flex",
							marginLeft: 16,
							fontSize: 26,
							letterSpacing: "-0.01em",
						}}
					>
						LLM Gateway
						<span style={{ color: "#71717a", marginLeft: 10 }}>Docs</span>
					</div>
					{product.id === "gateway" ? null : (
						<div
							style={{
								display: "flex",
								alignItems: "center",
								marginLeft: 22,
								padding: "7px 16px",
								borderRadius: 9999,
								border: `1px solid ${product.accent}88`,
								backgroundColor: `${product.accent}1f`,
								color: product.accent,
								fontSize: 20,
							}}
						>
							{product.name}
						</div>
					)}
				</div>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						maxWidth: screenshot ? 600 : 960,
					}}
				>
					<div
						style={{
							display: "flex",
							fontSize: 20,
							letterSpacing: "0.14em",
							textTransform: "uppercase",
							color: product.accent,
							marginBottom: 18,
						}}
					>
						{section}
					</div>
					<div
						style={{
							display: "flex",
							fontSize: titleSize,
							lineHeight: 1.04,
							letterSpacing: "-0.035em",
							textWrap: "balance",
						}}
					>
						{title}
					</div>
					{page.data.description ? (
						<div
							style={{
								display: "block",
								marginTop: 22,
								fontSize: 25,
								lineHeight: 1.4,
								color: "#a1a1aa",
								lineClamp: 3,
							}}
						>
							{page.data.description}
						</div>
					) : null}
				</div>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						fontSize: 20,
						color: "#71717a",
					}}
				>
					<div
						style={{
							display: "flex",
							width: 10,
							height: 10,
							borderRadius: 9999,
							backgroundColor: product.accent,
							marginRight: 12,
						}}
					/>
					{`docs.llmgateway.io${path}`}
				</div>
			</div>
		</div>,
		{ width: 1200, height: 630 },
	);
}

export function generateStaticParams() {
	return source.generateParams().map((page) => ({
		...page,
		slug: [...page.slug, "image.png"],
	}));
}
