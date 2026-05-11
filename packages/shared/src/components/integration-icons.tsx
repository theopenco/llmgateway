import React from "react";

// Cline Icon
export const ClineIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 466.73 487.04"
		{...props}
	>
		<path
			d="m463.6 275.08-29.26-58.75V182.5c0-56.08-45.01-101.5-100.53-101.5H283.8c3.62-7.43 5.61-15.79 5.61-24.61C289.41 25.22 264.33 0 233.34 0s-56.07 25.22-56.07 56.39c0 8.82 1.99 17.17 5.61 24.61h-50.01C77.36 81 32.35 126.42 32.35 182.5v33.83L2.48 274.92c-3.01 5.9-3.01 12.92 0 18.81l29.87 57.93v33.83c0 56.08 45.01 101.5 100.52 101.5h200.95c55.51 0 100.53-45.42 100.53-101.5v-33.83l29.21-58.13c2.9-5.79 2.9-12.61.05-18.46Zm-260.85 47.88c0 25.48-20.54 46.14-45.88 46.14s-45.88-20.66-45.88-46.14v-82.02c0-25.48 20.54-46.14 45.88-46.14s45.88 20.66 45.88 46.14zm147.83 0c0 25.48-20.54 46.14-45.88 46.14s-45.88-20.66-45.88-46.14v-82.02c0-25.48 20.54-46.14 45.88-46.14s45.88 20.66 45.88 46.14z"
			fill="currentColor"
		/>
	</svg>
);

// OpenCode Icon
export const OpenCodeIcon: React.FC<React.SVGProps<SVGSVGElement>> = (
	props,
) => (
	<svg
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 240 300"
		{...props}
	>
		<path d="M180 240H60V120h120z" fill="currentColor" fillOpacity={0.5} />
		<path d="M180 60H60v180h120zm60 240H0V0h240z" fill="currentColor" />
	</svg>
);

// Cursor Icon
export const CursorIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 466.73 532.09"
		{...props}
	>
		<path
			d="M457.43 125.94 244.42 2.96c-6.84-3.95-15.28-3.95-22.12 0L9.3 125.94C3.55 129.26 0 135.4 0 142.05v247.99c0 6.65 3.55 12.79 9.3 16.11l213.01 122.98c6.84 3.95 15.28 3.95 22.12 0l213.01-122.98c5.75-3.32 9.3-9.46 9.3-16.11V142.05c0-6.65-3.55-12.79-9.3-16.11zm-13.38 26.05L238.42 508.15c-1.39 2.4-5.06 1.42-5.06-1.36V273.58c0-4.66-2.49-8.97-6.53-11.31L24.87 145.67c-2.4-1.39-1.42-5.06 1.36-5.06h411.26c5.84 0 9.49 6.33 6.57 11.39h-.01Z"
			fill="currentColor"
		/>
	</svg>
);

// n8n Icon
export const N8nIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
	<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" {...props}>
		<path
			clipRule="evenodd"
			d="M24 8.4c0 1.325-1.102 2.4-2.462 2.4-1.146 0-2.11-.765-2.384-1.8h-3.436c-.602 0-1.115.424-1.214 1.003l-.101.592a2.38 2.38 0 0 1-.8 1.405c.412.354.704.844.8 1.405l.1.592A1.222 1.222 0 0 0 15.719 15h.975c.273-1.035 1.237-1.8 2.384-1.8 1.36 0 2.461 1.075 2.461 2.4S20.436 18 19.078 18c-1.147 0-2.11-.765-2.384-1.8h-.975c-1.204 0-2.23-.848-2.428-2.005l-.101-.592a1.222 1.222 0 0 0-1.214-1.003H10.97c-.308.984-1.246 1.7-2.356 1.7-1.11 0-2.048-.716-2.355-1.7H4.817c-.308.984-1.246 1.7-2.355 1.7C1.102 14.3 0 13.225 0 11.9s1.102-2.4 2.462-2.4c1.183 0 2.172.815 2.408 1.9h1.337c.236-1.085 1.225-1.9 2.408-1.9 1.184 0 2.172.815 2.408 1.9h.952c.601 0 1.115-.424 1.213-1.003l.102-.592c.198-1.157 1.225-2.005 2.428-2.005h3.436c.274-1.035 1.238-1.8 2.384-1.8C22.898 6 24 7.075 24 8.4zm-1.23 0c0 .663-.552 1.2-1.232 1.2-.68 0-1.23-.537-1.23-1.2 0-.663.55-1.2 1.23-1.2.68 0 1.231.537 1.231 1.2zM2.461 13.1c.68 0 1.23-.537 1.23-1.2 0-.663-.55-1.2-1.23-1.2-.68 0-1.231.537-1.231 1.2 0 .663.55 1.2 1.23 1.2zm6.153 0c.68 0 1.231-.537 1.231-1.2 0-.663-.55-1.2-1.23-1.2-.68 0-1.231.537-1.231 1.2 0 .663.55 1.2 1.23 1.2zm10.462 3.7c.68 0 1.23-.537 1.23-1.2 0-.663-.55-1.2-1.23-1.2-.68 0-1.23.537-1.23 1.2 0 .663.55 1.2 1.23 1.2z"
			fill="#EA4B71"
			fillRule="evenodd"
		/>
	</svg>
);

// VS Code Icon
export const VSCodeIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" {...props}>
		<path
			d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"
			fill="currentColor"
		/>
	</svg>
);

// Codex CLI Icon
export const CodexIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
	<svg
		fill="currentColor"
		fillRule="evenodd"
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 24 24"
		{...props}
	>
		<path
			clipRule="evenodd"
			d="M8.086.457a6.105 6.105 0 0 1 3.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 0 0 .107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 0 1-.18 1.631.167.167 0 0 0 .04.155 5.982 5.982 0 0 1 1.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 0 1-2.934 1.851.162.162 0 0 0-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 0 0-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 0 1-2.595-.622 6.058 6.058 0 0 1-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 0 1-.495-1.283 6.11 6.11 0 0 1-.017-3.064.166.166 0 0 0 .008-.074.115.115 0 0 0-.037-.064 5.958 5.958 0 0 1-1.38-2.202 5.196 5.196 0 0 1-.333-1.589 6.915 6.915 0 0 1 .188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 0 0 .087-.087A6.016 6.016 0 0 1 5.635 2.31C6.315 1.464 7.132.846 8.086.457m-.804 7.85a.848.848 0 0 0-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 0 0 1.46.864l1.94-3.272a.849.849 0 0 0 .007-.854zm5.446 6.24a.849.849 0 0 0 0 1.695h4.848a.849.849 0 0 0 0-1.696h-4.848z"
		/>
	</svg>
);

// Autohand Icon
export const AutohandIcon: React.FC<React.SVGProps<SVGSVGElement>> = (
	props,
) => (
	<svg
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 261 124"
		{...props}
	>
		<circle
			cx="163.29"
			cy="94.3717"
			r="27.1283"
			stroke="currentColor"
			strokeWidth="5"
		/>
		<circle
			cx="163.839"
			cy="94.9203"
			r="7.73009"
			fill="currentColor"
			stroke="currentColor"
		/>
		<circle
			cx="163.29"
			cy="29.6283"
			r="27.1283"
			stroke="currentColor"
			strokeWidth="5"
		/>
		<circle
			cx="163.839"
			cy="30.1769"
			r="7.73009"
			fill="currentColor"
			stroke="currentColor"
		/>
		<circle
			cx="231.326"
			cy="94.3717"
			r="27.1283"
			stroke="currentColor"
			strokeWidth="5"
		/>
		<circle
			cx="231.875"
			cy="94.9203"
			r="7.73009"
			fill="currentColor"
			stroke="currentColor"
		/>
		<circle
			cx="231.326"
			cy="29.6283"
			r="27.1283"
			stroke="currentColor"
			strokeWidth="5"
		/>
		<circle
			cx="231.875"
			cy="30.1769"
			r="7.73009"
			fill="currentColor"
			stroke="currentColor"
		/>
		<circle
			cx="29.6283"
			cy="94.3717"
			r="27.1283"
			stroke="currentColor"
			strokeWidth="5"
		/>
		<circle
			cx="30.1774"
			cy="94.9203"
			r="7.73009"
			fill="currentColor"
			stroke="currentColor"
		/>
		<circle
			cx="29.6283"
			cy="29.6283"
			r="27.1283"
			stroke="currentColor"
			strokeWidth="5"
		/>
		<circle
			cx="30.1774"
			cy="30.1769"
			r="7.73009"
			fill="currentColor"
			stroke="currentColor"
		/>
		<circle
			cx="97.6635"
			cy="94.3717"
			r="27.1283"
			stroke="currentColor"
			strokeWidth="5"
		/>
		<circle
			cx="98.2125"
			cy="94.9203"
			r="7.73009"
			fill="currentColor"
			stroke="currentColor"
		/>
		<circle
			cx="97.6635"
			cy="29.6283"
			r="27.1283"
			stroke="currentColor"
			strokeWidth="5"
		/>
		<circle
			cx="98.2125"
			cy="30.1769"
			r="7.73009"
			fill="currentColor"
			stroke="currentColor"
		/>
	</svg>
);

// SoulForge Icon — rendered as a raster mark (anvil + flame) hosted from each
// app's public dir at /integrations/soulforge.png. The component still accepts
// SVGProps for backward compatibility with callers that pass className.
export const SoulForgeIcon: React.FC<React.SVGProps<SVGSVGElement>> = ({
	className,
	style,
}) => (
	<img
		src="/integrations/soulforge.png"
		alt="SoulForge"
		className={className as string | undefined}
		style={
			{
				objectFit: "contain",
				...(style as React.CSSProperties | undefined),
			} as React.CSSProperties
		}
	/>
);

// Continue Icon
export const ContinueIcon: React.FC<React.SVGProps<SVGSVGElement>> = (
	props,
) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 26 24"
		fill="none"
		{...props}
	>
		<path
			d="M20.5286 3.26811L19.1512 5.65694L22.6328 11.6849C22.6582 11.7306 22.6735 11.7866 22.6735 11.8374C22.6735 11.8882 22.6582 11.9441 22.6328 11.9899L19.1512 18.0229L20.5286 20.4117L25.4791 11.8374L20.5286 3.26303V3.26811ZM18.6176 5.3469L19.995 2.95807H17.2402L15.8628 5.3469H18.6227H18.6176ZM15.8577 5.96697L19.075 11.5324H21.8298L18.6176 5.96697H15.8577ZM18.6176 17.7179L21.8298 12.1474H19.075L15.8577 17.7179H18.6176ZM15.8577 18.338L17.2351 20.7167H19.9899L18.6125 18.338H15.8526H15.8577ZM6.52098 21.3063C6.46507 21.3063 6.41424 21.291 6.3685 21.2656C6.32276 21.2402 6.28209 21.1995 6.25668 21.1538L2.77002 15.1207H0.0152482L4.9657 23.69H14.8615L13.4841 21.3063H6.52606H6.52098ZM14.0178 20.9962L15.3952 23.38L16.7726 20.9911L15.3952 18.6023L14.0178 20.9911V20.9962ZM14.8615 18.2974H8.43712L7.05973 20.6862H13.4841L14.8615 18.2974ZM7.89836 17.9924L4.68108 12.4219L3.30369 14.8107L6.52098 20.3812L7.89836 17.9924ZM0.0101654 14.5007H2.76494L4.14232 12.1118H1.39263L0.0101654 14.5007ZM6.24143 2.5413C6.26685 2.49556 6.30751 2.4549 6.35325 2.42948C6.399 2.40407 6.4549 2.38882 6.50573 2.38882H13.474L14.8514 0H4.95045L0 8.57435H2.75477L6.23127 2.54638L6.24143 2.5413ZM4.14232 11.5782L2.76494 9.18934H0.0101654L1.38755 11.5782H4.14232ZM6.51081 3.31386L3.29861 8.8793L4.67599 11.2681L7.8882 5.70268L6.51081 3.31386ZM13.4791 3.00382H7.04448L8.42187 5.39264H14.8564L13.4791 3.00382ZM15.3952 5.0826L16.7675 2.69886L15.3952 0.310038L14.0178 2.69378L15.3952 5.0826Z"
			fill="currentColor"
		/>
	</svg>
);

// Hermes Agent Icon
export const HermesAgentIcon: React.FC<React.SVGProps<SVGSVGElement>> = (
	props,
) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 64 64"
		fill="none"
		{...props}
	>
		<rect x="30" y="10" width="4" height="46" rx="2" fill="currentColor" />
		<path
			d="M30 18 C24 14, 14 14, 10 18 C14 16, 22 16, 28 20"
			fill="currentColor"
		/>
		<path
			d="M30 22 C26 19, 18 19, 14 22 C18 20, 24 20, 28 24"
			fill="currentColor"
		/>
		<path
			d="M34 18 C40 14, 50 14, 54 18 C50 16, 42 16, 36 20"
			fill="currentColor"
		/>
		<path
			d="M34 22 C38 19, 46 19, 50 22 C46 20, 40 20, 36 24"
			fill="currentColor"
		/>
		<path
			d="M32 48 C22 44, 20 38, 26 34 C20 36, 18 42, 24 46 C18 40, 22 30, 30 28 C24 32, 22 38, 28 42"
			stroke="currentColor"
			strokeWidth="2.5"
			strokeLinecap="round"
		/>
		<path
			d="M32 48 C42 44, 44 38, 38 34 C44 36, 46 42, 40 46 C46 40, 42 30, 34 28 C40 32, 42 38, 36 42"
			stroke="currentColor"
			strokeWidth="2.5"
			strokeLinecap="round"
		/>
		<circle cx="32" cy="10" r="4" fill="currentColor" />
	</svg>
);

// OpenClaw Icon
export const OpenClawIcon: React.FC<React.SVGProps<SVGSVGElement>> = (
	props,
) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 16 16"
		aria-label="Pixel lobster"
		{...props}
	>
		<path fill="none" d="M0 0h16v16H0z" />
		<g fill="#3a0a0d">
			<path d="M1 5h1v3H1zM2 4h1v1H2zM2 8h1v1H2zM3 3h1v1H3zM3 9h1v1H3zM4 2h1v1H4zM4 10h1v1H4zM5 2h6v1H5zM11 2h1v1h-1zM12 3h1v1h-1zM12 9h1v1h-1zM13 4h1v1h-1zM13 8h1v1h-1zM14 5h1v3h-1zM5 11h6v1H5zM4 12h1v1H4zM11 12h1v1h-1zM3 13h1v1H3zM12 13h1v1h-1zM5 14h6v1H5z" />
		</g>
		<g fill="#ff4f40">
			<path d="M5 3h6v1H5zM4 4h8v1H4zM3 5h10v1H3zM3 6h10v1H3zM3 7h10v1H3zM4 8h8v1H4zM5 9h6v1H5zM5 12h6v1H5zM6 13h4v1H6z" />
		</g>
		<g fill="#ff775f">
			<path d="M1 6h2v1H1zM2 5h1v1H2zM2 7h1v1H2zM13 6h2v1h-2zM13 5h1v1h-1zM13 7h1v1h-1z" />
		</g>
		<g fill="#081016">
			<path d="M6 5h1v1H6zM9 5h1v1H9z" />
		</g>
		<g fill="#f5fbff">
			<path d="M6 4h1v1H6zM9 4h1v1H9z" />
		</g>
	</svg>
);
