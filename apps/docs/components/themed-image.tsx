export function ThemedImage({
	alt,
	basePath,
}: {
	alt: string;
	basePath: string;
}) {
	// lazy keeps the display:none variant of the inactive theme from being
	// downloaded (browsers skip lazy images that never enter the viewport) and
	// defers below-the-fold screenshots.
	return (
		<>
			<img
				src={`${basePath}-light.png`}
				alt={alt}
				loading="lazy"
				decoding="async"
				className="block dark:hidden rounded-lg border"
			/>
			<img
				src={`${basePath}-dark.png`}
				alt={alt}
				loading="lazy"
				decoding="async"
				className="hidden dark:block rounded-lg border"
			/>
		</>
	);
}
