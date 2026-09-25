import type { SVGProps } from "react";

/** A passport cover stamped with code brackets. */
export function DevPassLogo(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 32 32"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{...props}
		>
			<rect x="5" y="3" width="23" height="27" rx="4" />
			<path d="M9 3v27M16 10l-3 3 3 3m6-6 3 3-3 3M17 21h6M17 25h3" />
		</svg>
	);
}

/** An airport lounge seat inside a conversation bubble. */
export function LoungeLogo(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 32 32"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{...props}
		>
			<path d="M9 3h14a6 6 0 0 1 6 6v12a6 6 0 0 1-6 6h-9l-7 3v-4a6 6 0 0 1-4-5V9a6 6 0 0 1 6-6Z" />
			<path d="m10 10 3 8h9m-11-5 3 2h6m-7 3-2 4m9-4 2 4" />
		</svg>
	);
}

/** Rotating-beacon mark: a control tower light seen from above. */
export function AirsideLogo(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 32 32"
			fill="none"
			aria-hidden="true"
			{...props}
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
				opacity="0.7"
			/>
		</svg>
	);
}
