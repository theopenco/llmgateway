import dimensions from "@/lib/provider-logo-dimensions.json";

export function ProviderLogo({
	provider,
	className = "mx-auto h-16 w-fit object-contain",
}: {
	provider: keyof typeof dimensions;
	className?: string;
}) {
	const logo = dimensions[provider];
	const [x, y, width, height] = logo.viewBox.split(" ").map(Number);
	if ("src" in logo) {
		return (
			<img
				src={logo.src}
				alt=""
				width={width}
				height={height}
				loading="lazy"
				decoding="async"
				className={className}
			/>
		);
	}
	return (
		<svg
			viewBox={logo.viewBox}
			className={`${className} text-black dark:text-white`}
			aria-hidden="true"
		>
			<use
				href={`/provider-logos.svg#${provider}`}
				x={x}
				y={y}
				width={width}
				height={height}
			/>
		</svg>
	);
}
