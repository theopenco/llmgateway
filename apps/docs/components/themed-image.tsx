import Image from "next/image";

const sizes = "(min-width: 1024px) 804px, (min-width: 768px) 430px, 100vw";

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
			<Image
				src={`${basePath}-light.png`}
				alt={alt}
				width={width}
				height={height}
				sizes={sizes}
				className="block dark:hidden rounded-lg border"
			/>
			<Image
				src={`${basePath}-dark.png`}
				alt={alt}
				width={width}
				height={darkHeight}
				sizes={sizes}
				className="hidden dark:block rounded-lg border"
			/>
		</>
	);
}
