import { cn } from "@/lib/utils";

import type { Experimental_GeneratedImage } from "ai";

export type ImageProps = Omit<Experimental_GeneratedImage, "uint8Array"> & {
	uint8Array?: Uint8Array;
	className?: string;
	alt?: string;
};

export const Image = ({
	base64,
	mediaType,
	uint8Array,
	...props
}: ImageProps) => (
	<img
		{...props}
		alt={props.alt}
		className={cn(
			"h-auto max-w-full overflow-hidden rounded-md",
			props.className,
		)}
		src={`data:${mediaType};base64,${base64}`}
	/>
);
