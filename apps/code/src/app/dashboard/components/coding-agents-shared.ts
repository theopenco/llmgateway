import {
	AnthropicIcon,
	AutohandIcon,
	ClineIcon,
	CodexIcon,
	CursorIcon,
	DevPassCodeIcon,
	EmpryoIcon,
	N8nIcon,
	OpenClawIcon,
	OpenCodeIcon,
	SoulForgeIcon,
} from "@llmgateway/shared/components";

import type { paths } from "@/lib/api/v1";
import type { ComponentType, SVGProps } from "react";

export type ApiLog =
	paths["/logs"]["get"]["responses"][200]["content"]["application/json"]["logs"][number];

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export interface AgentDefinition {
	id: string;
	label: string;
	icon: IconComponent;
	sources: string[];
	guideUrl: string;
}

export const AGENTS: AgentDefinition[] = [
	{
		id: "devpass-code",
		label: "DevPass Code",
		icon: DevPassCodeIcon,
		sources: ["devpass-code"],
		guideUrl: "/guides/devpass-code",
	},
	{
		id: "claude-code",
		label: "Claude Code",
		icon: AnthropicIcon,
		sources: ["claude.com/claude-code"],
		guideUrl: "/guides/claude-code",
	},
	{
		id: "opencode",
		label: "OpenCode",
		icon: OpenCodeIcon,
		sources: ["opencode", "open-code"],
		guideUrl: "/guides/opencode",
	},
	{
		id: "cursor",
		label: "Cursor",
		icon: CursorIcon,
		sources: ["cursor"],
		guideUrl: "/guides/cursor",
	},
	{
		id: "autohand",
		label: "Autohand Code",
		icon: AutohandIcon,
		sources: ["autohand"],
		guideUrl: "/guides/autohand",
	},
	{
		id: "empryo",
		label: "Empryo",
		icon: EmpryoIcon,
		sources: ["empryo"],
		guideUrl: "/guides/empryo",
	},
	{
		id: "soulforge",
		label: "SoulForge",
		icon: SoulForgeIcon,
		sources: ["soulforge"],
		guideUrl: "/guides/soulforge",
	},
	{
		id: "cline",
		label: "Cline",
		icon: ClineIcon,
		sources: ["cline"],
		guideUrl: "/guides/cline",
	},
	{
		id: "codex",
		label: "Codex CLI",
		icon: CodexIcon,
		sources: ["codex"],
		guideUrl: "/guides/codex",
	},
	{
		id: "n8n",
		label: "n8n",
		icon: N8nIcon,
		sources: ["n8n"],
		guideUrl: "/guides/n8n",
	},
	{
		id: "openclaw",
		label: "OpenClaw",
		icon: OpenClawIcon,
		sources: ["openclaw"],
		guideUrl: "/guides/openclaw",
	},
];

export const ALL_CODING_AGENT_SOURCES = AGENTS.flatMap((a) => a.sources);

export interface ModelUsage {
	id: string;
	provider: string;
	requestCount: number;
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	cost: number;
	cachedInputCost: number;
}

export interface AgentStats {
	agent: AgentDefinition;
	requestCount: number;
	totalCost: number;
	totalTokens: number;
	totalPromptTokens: number;
	totalCompletionTokens: number;
	lastActive: Date;
	logs: ApiLog[];
	modelBreakdown: ModelUsage[];
}

export function formatTokens(count: number): string {
	if (count >= 1_000_000) {
		return `${(count / 1_000_000).toFixed(1)}M`;
	}
	if (count >= 1_000) {
		return `${(count / 1_000).toFixed(1)}K`;
	}
	return count.toLocaleString();
}

export function formatLastActive(date: Date): string {
	const now = new Date();
	const diff = now.getTime() - date.getTime();
	const minutes = Math.floor(diff / (1000 * 60));
	const hours = Math.floor(diff / (1000 * 60 * 60));
	const days = Math.floor(diff / (1000 * 60 * 60 * 24));

	if (minutes < 1) {
		return "Just now";
	}
	if (minutes < 60) {
		return `${minutes}m ago`;
	}
	if (hours < 24) {
		return `${hours}h ago`;
	}
	if (days < 7) {
		return `${days}d ago`;
	}
	return date.toLocaleDateString();
}

export function computeModelBreakdown(logs: ApiLog[]): ModelUsage[] {
	const map = new Map<string, ModelUsage>();
	for (const log of logs) {
		const id = log.usedModel || log.requestedModel || "unknown";
		const provider = log.usedProvider || log.requestedProvider || "—";
		const key = `${provider}|${id}`;
		let entry = map.get(key);
		if (!entry) {
			entry = {
				id,
				provider,
				requestCount: 0,
				promptTokens: 0,
				completionTokens: 0,
				totalTokens: 0,
				cost: 0,
				cachedInputCost: 0,
			};
			map.set(key, entry);
		}
		entry.requestCount += 1;
		entry.promptTokens += Number(log.promptTokens ?? 0);
		entry.completionTokens += Number(log.completionTokens ?? 0);
		entry.totalTokens += Number(log.totalTokens ?? 0);
		entry.cost += log.cost ?? 0;
		entry.cachedInputCost += Number(log.cachedInputCost ?? 0);
	}
	return Array.from(map.values()).sort((a, b) => b.cost - a.cost);
}

export function computeAgentStats(logs: ApiLog[]): AgentStats[] {
	const stats: AgentStats[] = [];
	for (const agent of AGENTS) {
		const sources = agent.sources.map((s) => s.toLowerCase());
		const agentLogs = logs.filter((log) => {
			const src = String(log.source ?? "").toLowerCase();
			return src.length > 0 && sources.includes(src);
		});
		if (agentLogs.length === 0) {
			continue;
		}
		const sorted = [...agentLogs].sort(
			(a, b) =>
				new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		);
		stats.push({
			agent,
			requestCount: agentLogs.length,
			totalCost: agentLogs.reduce((sum, log) => sum + (log.cost ?? 0), 0),
			totalTokens: agentLogs.reduce(
				(sum, log) => sum + Number(log.totalTokens ?? 0),
				0,
			),
			totalPromptTokens: agentLogs.reduce(
				(sum, log) => sum + Number(log.promptTokens ?? 0),
				0,
			),
			totalCompletionTokens: agentLogs.reduce(
				(sum, log) => sum + Number(log.completionTokens ?? 0),
				0,
			),
			lastActive: new Date(sorted[0].createdAt),
			logs: agentLogs,
			modelBreakdown: computeModelBreakdown(agentLogs),
		});
	}
	return stats.sort((a, b) => b.totalCost - a.totalCost);
}
