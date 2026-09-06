import { logoPaths } from "./logo-paths";

export type LogoProps = React.HTMLAttributes<SVGElement>;

export const Logo = (props: LogoProps) => (
	<svg
		fill="none"
		{...props}
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 218 232"
	>
		{logoPaths.map((d) => (
			<path key={d} d={d} fill="currentColor" />
		))}
	</svg>
);
