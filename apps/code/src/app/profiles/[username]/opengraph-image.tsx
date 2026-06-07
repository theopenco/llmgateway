import { ImageResponse } from "next/og";

import {
	AGENTS,
	formatTokens,
} from "@/app/dashboard/components/coding-agents-shared";
import { fetchPublicProfile } from "@/lib/public-profile";

export const alt = "DevPass profile";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const AGENT_LABEL_BY_SOURCE = new Map<string, string>();
for (const agent of AGENTS) {
	for (const source of agent.sources) {
		AGENT_LABEL_BY_SOURCE.set(source.toLowerCase(), agent.label);
	}
}

function cellColor(count: number, max: number): string {
	if (count === 0 || max === 0) {
		return "#1f1f23";
	}
	const ratio = count / max;
	if (ratio < 0.15) {
		return "rgba(16,185,129,0.32)";
	}
	if (ratio < 0.4) {
		return "rgba(16,185,129,0.52)";
	}
	if (ratio < 0.7) {
		return "rgba(16,185,129,0.76)";
	}
	return "#10b981";
}

function buildWeeks(activity: { date: string; requestCount: number }[]) {
	const today = new Date();
	today.setUTCHours(0, 0, 0, 0);
	const start = new Date(today);
	start.setUTCDate(start.getUTCDate() - 364);
	const gridStart = new Date(start);
	gridStart.setUTCDate(gridStart.getUTCDate() - start.getUTCDay());

	const counts = new Map<string, number>();
	for (const row of activity) {
		counts.set(row.date.slice(0, 10), row.requestCount ?? 0);
	}

	const weeks: number[][] = [];
	let max = 0;
	const totalWeeks = 53;
	for (let w = 0; w < totalWeeks; w++) {
		const week: number[] = [];
		for (let d = 0; d < 7; d++) {
			const cellDate = new Date(gridStart);
			const offset = w * 7;
			cellDate.setUTCDate(gridStart.getUTCDate() + offset + d);
			if (cellDate < start || cellDate > today) {
				week.push(-1);
				continue;
			}
			const key = cellDate.toISOString().slice(0, 10);
			const c = counts.get(key) ?? 0;
			if (c > max) {
				max = c;
			}
			week.push(c);
		}
		weeks.push(week);
	}
	return { weeks, max };
}

export default async function OgImage({
	params,
}: {
	params: Promise<{ username: string }>;
}) {
	const { username } = await params;
	const profile = await fetchPublicProfile(username);

	const displayName =
		profile?.name?.trim() || (profile ? `@${profile.username}` : "DevPass");
	const handle = profile?.username ? `@${profile.username}` : "";
	const { weeks, max } = buildWeeks(profile?.activity ?? []);
	const topAgentLabel =
		profile && profile.agents.length > 0
			? (AGENT_LABEL_BY_SOURCE.get(profile.agents[0].source.toLowerCase()) ??
				profile.agents[0].source)
			: null;

	return new ImageResponse(
		(
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					flexDirection: "column",
					background: "#0a0a0b",
					padding: "64px",
					fontFamily: "sans-serif",
					position: "relative",
				}}
			>
				{/* Top: brand + top coding agent */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
					}}
				>
					<div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								width: "44px",
								height: "44px",
								borderRadius: "12px",
								background: "#fafafa",
								color: "#0a0a0b",
								fontSize: "24px",
								fontWeight: 700,
							}}
						>
							{"</>"}
						</div>
						<div
							style={{ display: "flex", alignItems: "baseline", gap: "10px" }}
						>
							<span
								style={{ color: "#fafafa", fontSize: "30px", fontWeight: 700 }}
							>
								DevPass
							</span>
							<span style={{ color: "#71717a", fontSize: "20px" }}>
								by LLM Gateway
							</span>
						</div>
					</div>

					{topAgentLabel && (
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "10px",
								padding: "10px 18px",
								borderRadius: "9999px",
								background: "rgba(16,185,129,0.12)",
								border: "1px solid rgba(16,185,129,0.35)",
							}}
						>
							<div
								style={{
									width: "10px",
									height: "10px",
									borderRadius: "9999px",
									background: "#10b981",
								}}
							/>
							<span
								style={{ color: "#fafafa", fontSize: "22px", fontWeight: 600 }}
							>
								{topAgentLabel}
							</span>
						</div>
					)}
				</div>

				{/* Name */}
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						marginTop: "44px",
					}}
				>
					<span style={{ color: "#fafafa", fontSize: "64px", fontWeight: 700 }}>
						{displayName}
					</span>
					{handle && (
						<span
							style={{ color: "#a1a1aa", fontSize: "28px", marginTop: "4px" }}
						>
							{handle}
						</span>
					)}
				</div>

				{/* Stats */}
				<div style={{ display: "flex", gap: "48px", marginTop: "32px" }}>
					<div style={{ display: "flex", flexDirection: "column" }}>
						<span
							style={{ color: "#fafafa", fontSize: "38px", fontWeight: 600 }}
						>
							{formatTokens(profile?.stats.totalTokens ?? 0)}
						</span>
						<span style={{ color: "#71717a", fontSize: "18px" }}>tokens</span>
					</div>
					<div style={{ display: "flex", flexDirection: "column" }}>
						<span
							style={{ color: "#fafafa", fontSize: "38px", fontWeight: 600 }}
						>
							{profile?.stats.currentStreak ?? 0}d
						</span>
						<span style={{ color: "#71717a", fontSize: "18px" }}>streak</span>
					</div>
					<div style={{ display: "flex", flexDirection: "column" }}>
						<span
							style={{ color: "#fafafa", fontSize: "38px", fontWeight: 600 }}
						>
							{profile?.stats.activeDays ?? 0}
						</span>
						<span style={{ color: "#71717a", fontSize: "18px" }}>
							active days
						</span>
					</div>
				</div>

				{/* Heatmap */}
				<div
					style={{
						display: "flex",
						gap: "4px",
						marginTop: "auto",
					}}
				>
					{weeks.map((week, wi) => (
						<div
							key={wi}
							style={{ display: "flex", flexDirection: "column", gap: "4px" }}
						>
							{week.map((count, di) => (
								<div
									key={di}
									style={{
										width: "14px",
										height: "14px",
										borderRadius: "3px",
										background:
											count < 0 ? "transparent" : cellColor(count, max),
									}}
								/>
							))}
						</div>
					))}
				</div>
			</div>
		),
		size,
	);
}
