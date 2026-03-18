export function ThemedImage({
	alt,
	basePath,
}: {
	alt: string;
	basePath: string;
}) {
	return (
		<>
			<img
				src={`${basePath}-light.png`}
				alt={alt}
				className="block dark:hidden rounded-lg border"
			/>
			<img
				src={`${basePath}-dark.png`}
				alt={alt}
				className="hidden dark:block rounded-lg border"
			/>
		</>
	);
}
