import dimensions from "@/lib/provider-logo-dimensions.json";

export function ProviderLogo({
	provider,
	className = "mx-auto h-16 w-fit object-contain",
}: {
	provider: keyof typeof dimensions;
	className?: string;
}) {
	const logo = dimensions[provider];
	if ("src" in logo && typeof logo.src === "string") {
		return <img src={logo.src} alt="" loading="lazy" className={className} />;
	}
	const [x, y, width, height] = logo.viewBox.split(" ").map(Number);
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
