import { cn } from "@/lib/utils";

/** Rotating-beacon mark: a control tower light seen from above. */
export function Logo({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 32 32"
			fill="none"
			aria-hidden="true"
			className={cn("size-7", className)}
		>
			<rect width="32" height="32" rx="7" className="fill-foreground" />
			<circle cx="16" cy="16" r="3" className="fill-background" />
			<path
				d="M16 16 L28 10 L28 22 Z"
				className="fill-background"
				opacity="0.55"
			/>
			<circle
				cx="16"
				cy="16"
				r="8.5"
				className="stroke-background"
				strokeWidth="1.5"
				strokeDasharray="3 4"
				fill="none"
				opacity="0.7"
			/>
		</svg>
	);
}
