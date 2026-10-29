import type { SVGProps } from "react";

export const AIRWORTHY_NAME = "Airworthy";
export const AIRWORTHY_STANDARD = "AW-1";

interface AirworthyStampProps extends Omit<
	SVGProps<SVGSVGElement>,
	"children"
> {
	/** Printed under the band; omit for the generic mark. */
	certificateNumber?: string;
	/** Ink grain and rough edges. Off for tiny sizes where it reads as noise. */
	texture?: boolean;
	title?: string;
}

const RING_TEXT =
	"AIRWORTHY \u2022 CERTIFIED CARRIER \u2022 AIRSIDE BY LLM GATEWAY \u2022";

/** Lucide "plane" (ISC), drawn on a 24px grid. */
const PLANE_PATH =
	"M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z";

/**
 * The Airworthy certification stamp. Drawn in `currentColor`, so it takes the
 * ink of whatever text color it sits in, on any theme.
 */
export function AirworthyStamp({
	certificateNumber,
	texture = true,
	title = "Airworthy certified carrier",
	...props
}: AirworthyStampProps) {
	// Deterministic ids keep the SVG renderable from server components; two
	// stamps with the same number share identical defs, which is harmless.
	const key = (certificateNumber ?? "mark").replace(/[^A-Za-z0-9]/g, "");
	const ringId = `aw-ring-${key}`;
	const maskId = `aw-knockout-${key}`;
	const inkId = `aw-ink-${key}`;
	return (
		<svg
			viewBox="0 0 200 200"
			role="img"
			aria-label={
				certificateNumber ? `${title}, certificate ${certificateNumber}` : title
			}
			{...props}
		>
			<title>{title}</title>
			<defs>
				<path
					id={ringId}
					d="M 23,100 a 77,77 0 1,1 154,0 a 77,77 0 1,1 -154,0"
				/>
				<mask id={maskId}>
					<rect width="200" height="200" fill="white" />
					<text
						x="100"
						y="108.5"
						textAnchor="middle"
						fontSize="17"
						fontWeight="900"
						letterSpacing="3.2"
						fill="black"
						style={{ fontFamily: "inherit" }}
					>
						CERTIFIED
					</text>
				</mask>
				{texture ? (
					<filter id={inkId} x="-5%" y="-5%" width="110%" height="110%">
						<feTurbulence
							type="fractalNoise"
							baseFrequency="0.85"
							numOctaves="2"
							seed="7"
							result="grain"
						/>
						<feDisplacementMap
							in="SourceGraphic"
							in2="grain"
							scale="1.6"
							xChannelSelector="R"
							yChannelSelector="G"
							result="rough"
						/>
						<feColorMatrix
							in="grain"
							type="matrix"
							values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1 1.5"
							result="speckle"
						/>
						<feComposite in="rough" in2="speckle" operator="in" />
					</filter>
				) : null}
			</defs>
			<g
				fill="none"
				stroke="currentColor"
				filter={texture ? `url(#${inkId})` : undefined}
			>
				<circle cx="100" cy="100" r="95" strokeWidth="4" />
				<circle cx="100" cy="100" r="89" strokeWidth="1.25" />
				<circle cx="100" cy="100" r="67" strokeWidth="1.75" />
				<circle
					cx="100"
					cy="100"
					r="62"
					strokeWidth="0.75"
					strokeDasharray="1.5 3"
				/>
				<text
					fill="currentColor"
					stroke="none"
					fontSize="12.5"
					fontWeight="800"
					style={{ fontFamily: "inherit" }}
				>
					<textPath href={`#${ringId}`} textLength="474" lengthAdjust="spacing">
						{RING_TEXT}
					</textPath>
				</text>
				<g
					transform="translate(84 50) scale(1.35)"
					strokeWidth="1.6"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d={PLANE_PATH} />
				</g>
				<rect
					x="29"
					y="88"
					width="142"
					height="27"
					fill="currentColor"
					stroke="none"
					mask={`url(#${maskId})`}
				/>
				<text
					x="100"
					y="132"
					textAnchor="middle"
					fill="currentColor"
					stroke="none"
					fontSize={certificateNumber ? "8.5" : "10"}
					fontWeight="700"
					letterSpacing="1.4"
					style={{
						fontFamily:
							"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
					}}
				>
					{certificateNumber ?? "STANDARD AW-1"}
				</text>
				<text
					x="100"
					y="145"
					textAnchor="middle"
					fill="currentColor"
					stroke="none"
					fontSize="7"
					fontWeight="700"
					letterSpacing="2.4"
					style={{ fontFamily: "inherit" }}
				>
					{certificateNumber ? "STANDARD AW-1" : "VERIFIED CLAIMS"}
				</text>
			</g>
		</svg>
	);
}
