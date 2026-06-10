import { cn } from "@/lib/utils";

export interface AudioProps {
	base64: string;
	mediaType: string;
	className?: string;
	"aria-label"?: string;
}

export const Audio = ({
	base64,
	mediaType,
	className,
	...props
}: AudioProps) => (
	<audio
		{...props}
		controls
		className={cn("w-full", className)}
		src={`data:${mediaType};base64,${base64}`}
	>
		<track kind="captions" />
	</audio>
);
