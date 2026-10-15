import { cn } from "@/lib/utils";

import { Chip, VisualFrame, stagger } from "./visual-frame";
import s from "./visuals.module.css";

import type { FeatureVisual, FlowStatus } from "@/lib/feature-visuals";

type FlowProps = Extract<FeatureVisual, { kind: "flow" }>;

const STATUS_COLOR: Record<FlowStatus, string> = {
	active: "var(--fa)",
	fallback: "oklch(0.769 0.188 70.08)",
	blocked: "oklch(0.645 0.246 16.439)",
	idle: "var(--muted-foreground)",
};

const HUB_CENTER = 280;
const MID_Y = 140;
const TARGET_X = 420;

function hubWidth(label: string) {
	const text = label.length * 7.6;
	const padded = text + 46;
	return Math.min(170, Math.max(132, padded));
}

function targetY(index: number, count: number) {
	if (count === 1) {
		return MID_Y;
	}
	const top = count > 4 ? 32 : 52;
	const bottom = 280 - top;
	const step = (bottom - top) / (count - 1);
	const offset = step * index;
	return top + offset;
}

function branchPath(startX: number, y: number) {
	const midX = (startX + TARGET_X) / 2;
	return `M${startX} ${MID_Y} C${midX} ${MID_Y} ${midX} ${y} ${TARGET_X} ${y}`;
}

function packetPath(startX: number, y: number) {
	const midX = (startX + TARGET_X) / 2;
	return `M140 ${MID_Y} L${startX} ${MID_Y} C${midX} ${MID_Y} ${midX} ${y} ${TARGET_X} ${y}`;
}

export function FlowVisual({ source, hub, targets, caption }: FlowProps) {
	const hubW = hubWidth(hub);
	const halfHub = hubW / 2;
	const hubX = HUB_CENTER - halfHub;
	const hubEnd = hubX + hubW;
	const blockX = (hubEnd + TARGET_X + 12) / 2;
	const firstActive = targets.findIndex((t) => t.status === "active");
	return (
		<VisualFrame title={`${source} → ${hub}`}>
			<svg
				viewBox="0 0 560 280"
				className="h-auto w-full font-sans"
				role="img"
				aria-label={`${source} sends requests through ${hub} to ${targets
					.map((t) => t.label)
					.join(", ")}`}
			>
				<path
					d={`M140 ${MID_Y} L${hubX} ${MID_Y}`}
					pathLength={1}
					className={s.draw}
					stroke="var(--fa)"
					strokeWidth={1.5}
					fill="none"
				/>
				{targets.map((target, i) => {
					const y = targetY(i, targets.length);
					return (
						<path
							key={target.label}
							d={branchPath(hubEnd, y)}
							stroke={STATUS_COLOR[target.status]}
							strokeOpacity={target.status === "idle" ? 0.35 : 0.8}
							strokeWidth={1.5}
							fill="none"
							className={
								target.status === "blocked" || target.status === "idle"
									? undefined
									: s.flowDash
							}
							strokeDasharray={target.status === "blocked" ? "3 5" : undefined}
						/>
					);
				})}
				<g className={s.motion}>
					{targets.map((target, i) => {
						if (target.status === "idle") {
							return null;
						}
						const y = targetY(i, targets.length);
						const begin =
							target.status === "fallback"
								? "1.4s"
								: `${Math.max(0, i - Math.max(0, firstActive)) * 0.35}s`;
						const blocked = target.status === "blocked";
						return (
							<circle
								key={target.label}
								r={4}
								fill={STATUS_COLOR[target.status]}
								opacity={0}
							>
								<animateMotion
									dur="2.8s"
									begin={begin}
									repeatCount="indefinite"
									path={packetPath(hubEnd, y)}
									keyPoints={blocked ? "0;0.66;0.66" : "0;1;1"}
									keyTimes="0;0.7;1"
									calcMode="linear"
								/>
								<animate
									attributeName="opacity"
									dur="2.8s"
									begin={begin}
									repeatCount="indefinite"
									values={blocked ? "0;1;1;0;0" : "0;1;1;0;0"}
									keyTimes={
										blocked ? "0;0.08;0.5;0.62;1" : "0;0.08;0.66;0.74;1"
									}
								/>
							</circle>
						);
					})}
				</g>

				<g className={s.enter} style={stagger(0)}>
					<rect
						x={12}
						y={MID_Y - 22}
						width={128}
						height={44}
						rx={12}
						fill="var(--background)"
						stroke="var(--border)"
					/>
					<text
						x={76}
						y={MID_Y + 4}
						textAnchor="middle"
						className="fill-foreground text-[12px] font-medium"
					>
						{source}
					</text>
				</g>

				<g className={s.enter} style={stagger(1)}>
					<rect
						x={hubX - 4}
						y={MID_Y - 32}
						width={hubW + 8}
						height={64}
						rx={18}
						fill="none"
						stroke="var(--fa)"
						className={s.pulse}
					/>
					<rect
						x={hubX}
						y={MID_Y - 28}
						width={hubW}
						height={56}
						rx={14}
						fill="var(--card)"
						stroke="var(--fa)"
						strokeWidth={1.5}
					/>
					<circle cx={hubX + 22} cy={MID_Y} r={7} fill="var(--fa)" />
					<circle cx={hubX + 22} cy={MID_Y} r={3} fill="var(--background)" />
					<text
						x={hubX + 36}
						y={MID_Y + 4}
						className="fill-foreground text-[12.5px] font-semibold"
					>
						{hub}
					</text>
				</g>

				{targets.map((target, i) => {
					const y = targetY(i, targets.length);
					const color = STATUS_COLOR[target.status];
					return (
						<g
							key={target.label}
							className={s.enter}
							style={stagger(i + 2)}
							opacity={target.status === "idle" ? 0.55 : 1}
						>
							<rect
								x={TARGET_X}
								y={y - 18}
								width={128}
								height={36}
								rx={10}
								fill="var(--background)"
								stroke={target.status === "idle" ? "var(--border)" : color}
								strokeOpacity={target.status === "idle" ? 1 : 0.6}
							/>
							<circle cx={TARGET_X + 13} cy={y} r={4} fill={color} />
							<text
								x={TARGET_X + 24}
								y={target.note ? y - 1 : y + 4}
								className="fill-foreground text-[11.5px] font-medium"
							>
								{target.label}
							</text>
							{target.note && (
								<text
									x={TARGET_X + 24}
									y={y + 11}
									className="fill-muted-foreground text-[9.5px]"
								>
									{target.note}
								</text>
							)}
							{target.status === "blocked" && (
								<g transform={`translate(${blockX} ${(MID_Y + y) / 2})`}>
									<circle r={8} fill="var(--background)" stroke={color} />
									<path
										d="M-3 -3 L3 3 M3 -3 L-3 3"
										stroke={color}
										strokeWidth={1.6}
										strokeLinecap="round"
									/>
								</g>
							)}
						</g>
					);
				})}
			</svg>
			{caption && (
				<div className="mt-3 flex justify-center">
					<Chip className={cn(s.enter)} style={stagger(targets.length + 2)}>
						<span className="size-1.5 rounded-full bg-[var(--fa)]" />
						{caption}
					</Chip>
				</div>
			)}
		</VisualFrame>
	);
}
