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
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" {...props}>
		<circle
			cx="25"
			cy="25"
			r="20"
			fill="none"
			stroke="currentColor"
			strokeWidth="8"
		/>
		<circle cx="25" cy="25" r="8" fill="currentColor" />
		<circle
			cx="75"
			cy="25"
			r="20"
			fill="none"
			stroke="currentColor"
			strokeWidth="8"
		/>
		<circle cx="75" cy="25" r="8" fill="currentColor" />
		<circle
			cx="125"
			cy="25"
			r="20"
			fill="none"
			stroke="currentColor"
			strokeWidth="8"
		/>
		<circle cx="125" cy="25" r="8" fill="currentColor" />
		<circle
			cx="175"
			cy="25"
			r="20"
			fill="none"
			stroke="currentColor"
			strokeWidth="8"
		/>
		<circle cx="175" cy="25" r="8" fill="currentColor" />
		<circle
			cx="25"
			cy="75"
			r="20"
			fill="none"
			stroke="currentColor"
			strokeWidth="8"
		/>
		<circle cx="25" cy="75" r="8" fill="currentColor" />
		<circle
			cx="75"
			cy="75"
			r="20"
			fill="none"
			stroke="currentColor"
			strokeWidth="8"
		/>
		<circle cx="75" cy="75" r="8" fill="currentColor" />
		<circle
			cx="125"
			cy="75"
			r="20"
			fill="none"
			stroke="currentColor"
			strokeWidth="8"
		/>
		<circle cx="125" cy="75" r="8" fill="currentColor" />
		<circle
			cx="175"
			cy="75"
			r="20"
			fill="none"
			stroke="currentColor"
			strokeWidth="8"
		/>
		<circle cx="175" cy="75" r="8" fill="currentColor" />
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
