export function ThemedImage({
	alt,
	basePath,
	width,
	height,
	darkHeight = height,
}: {
	alt: string;
	basePath: string;
	width: number;
	height: number;
	darkHeight?: number;
}) {
	return (
		<>
			<img
				src={`${basePath}-light.png`}
				alt={alt}
				width={width}
				height={height}
				loading="lazy"
				decoding="async"
				className="block dark:hidden rounded-lg border"
			/>
			<img
				src={`${basePath}-dark.png`}
				alt={alt}
				width={width}
				height={darkHeight}
				loading="lazy"
				decoding="async"
				className="hidden dark:block rounded-lg border"
			/>
		</>
	);
}
