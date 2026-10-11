import {
	AnimatedActivity,
	AnimatedBadgeCheck,
	AnimatedBarChart3,
	AnimatedBotMessageSquare,
	AnimatedBuilding2,
	AnimatedChartArea,
	AnimatedChartColumnBig,
	AnimatedExternalLink,
	AnimatedKey,
	AnimatedKeyRound,
	AnimatedKeySquare,
	AnimatedLayoutDashboard,
	AnimatedMessageSquare,
	AnimatedPercent,
	AnimatedShield,
	AnimatedShieldAlert,
	AnimatedTerminal,
	AnimatedUsers,
} from "@/components/dashboard/animated-nav-icons";

import type { AnimatedIconProps } from "@/components/dashboard/animated-nav-icons";
import type { ComponentType } from "react";

export type AnimatedIconComponent = ComponentType<AnimatedIconProps>;

export interface NavLink {
	href: string;
	label: string;
	icon?: AnimatedIconComponent;
	enterprise?: boolean;
	external?: boolean;
}

export const PROJECT_NAVIGATION: NavLink[] = [
	{ href: "", label: "Dashboard", icon: AnimatedLayoutDashboard },
	{ href: "activity", label: "Activity", icon: AnimatedActivity },
	{ href: "agents", label: "Agents", icon: AnimatedBotMessageSquare },
	{ href: "model-usage", label: "Model Usage", icon: AnimatedChartColumnBig },
	{ href: "analytics", label: "Analytics", icon: AnimatedChartArea },
	{ href: "usage", label: "Usage & Metrics", icon: AnimatedBarChart3 },
	{ href: "api-keys", label: "API Keys", icon: AnimatedKey },
];

export const PROJECT_SETTINGS: NavLink[] = [
	{ href: "settings/preferences", label: "Preferences" },
	{ href: "settings/sdk", label: "Payments SDK" },
	{ href: "settings/routing", label: "Routing" },
	{
		href: "settings/dynamic-routes",
		label: "Dynamic Routes",
		enterprise: true,
	},
	{ href: "settings/guardrails", label: "Guardrails", enterprise: true },
];

export const ORGANIZATION_NAVIGATION: NavLink[] = [
	{ href: "org/team", label: "Team", icon: AnimatedUsers },
	{ href: "org/provider-keys", label: "Provider Keys", icon: AnimatedKeyRound },
	{ href: "org/discounts", label: "Your Discounts", icon: AnimatedPercent },
	{ href: "org/models", label: "Models", icon: AnimatedBotMessageSquare },
	{
		href: "org/analytics",
		label: "Analytics",
		icon: AnimatedChartArea,
		enterprise: true,
	},
	{
		href: "org/skills",
		label: "Skills",
		icon: AnimatedTerminal,
		enterprise: true,
	},
	{
		href: "org/guardrails",
		label: "Guardrails",
		icon: AnimatedShield,
		enterprise: true,
	},
	{
		href: "org/compliance",
		label: "Compliance",
		icon: AnimatedBadgeCheck,
		enterprise: true,
	},
	{
		href: "org/security-events",
		label: "Security Events",
		icon: AnimatedShieldAlert,
		enterprise: true,
	},
	{
		href: "org/master-keys",
		label: "Master Keys",
		icon: AnimatedKeySquare,
		enterprise: true,
	},
	{ href: "org/sso", label: "SSO", icon: AnimatedBuilding2, enterprise: true },
];

export const ORGANIZATION_SETTINGS: NavLink[] = [
	{ href: "org/billing", label: "Billing" },
	{ href: "org/transactions", label: "Transactions" },
	{ href: "org/referrals", label: "Referrals" },
	{ href: "org/limits", label: "Limits" },
	{ href: "org/policies", label: "Policies" },
	{ href: "org/preferences", label: "Preferences" },
	{ href: "org/notifications", label: "Notifications" },
	{ href: "org/routing", label: "Smart Routing" },
	{ href: "org/audit-logs", label: "Audit Logs", enterprise: true },
];

export const TOOLS_RESOURCES: NavLink[] = [
	{
		href: "tools/devpass",
		label: "DevPass",
		icon: AnimatedTerminal,
		external: true,
	},
	{
		href: "tools/models",
		label: "Supported Models",
		icon: AnimatedMessageSquare,
	},
	{
		href: "tools/lounge",
		label: "Lounge",
		icon: AnimatedBotMessageSquare,
		external: true,
	},
	{
		href: "tools/docs",
		label: "Documentation",
		icon: AnimatedExternalLink,
		external: true,
	},
];

export const ACCOUNT_LINKS: NavLink[] = [
	{ href: "settings/account", label: "Account" },
	{ href: "settings/security", label: "Security" },
];

export interface SearchableLink extends NavLink {
	section: string;
}

export const SEARCHABLE_LINKS: SearchableLink[] = [
	...PROJECT_NAVIGATION.map((item) => ({ ...item, section: "Project" })),
	...PROJECT_SETTINGS.map((item) => ({
		...item,
		section: "Project Settings",
	})),
	...ORGANIZATION_NAVIGATION.map((item) => ({
		...item,
		section: "Organization",
	})),
	...ORGANIZATION_SETTINGS.map((item) => ({
		...item,
		section: "Org Settings",
	})),
	...TOOLS_RESOURCES.map((item) => ({ ...item, section: "Tools" })),
];

export const LIVE_VIEWS = [
	"",
	"activity",
	"agents",
	"model-usage",
	"analytics",
	"usage",
	"api-keys",
	"settings/preferences",
	"settings/sdk",
	"settings/routing",
	"org/team",
	"org/guardrails",
	"org/security-events",
	"org/sso",
	"org/audit-logs",
] as const;

export type LiveView = (typeof LIVE_VIEWS)[number];

export function isLiveView(view: string): view is LiveView {
	return (LIVE_VIEWS as readonly string[]).includes(view);
}

const ALL_LINKS: NavLink[] = [
	...SEARCHABLE_LINKS,
	...ACCOUNT_LINKS,
	{ href: "settings", label: "Settings" },
];

export function findNavLink(view: string): NavLink | undefined {
	return ALL_LINKS.find((item) => item.href === view);
}

export function isOrgView(view: string) {
	return view.startsWith("org/");
}
