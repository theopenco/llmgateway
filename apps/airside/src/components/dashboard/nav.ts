import {
	Activity,
	BookOpen,
	ClipboardList,
	Gauge,
	Palette,
	Plane,
	Settings,
	Tag,
	TriangleAlert,
	Trophy,
	Users,
} from "lucide-react";

import type { LucideIcon } from "lucide-react";

export interface NavItem {
	href: string;
	label: string;
	icon: LucideIcon;
	exact?: boolean;
	external?: boolean;
}

export interface NavGroup {
	label: string;
	items: NavItem[];
}

/** Numeric sidebar badges keyed by nav item href (e.g. "/dashboard/brand"). */
export type NavBadges = Partial<Record<string, number>>;

export function getNavGroups(uiUrl: string): NavGroup[] {
	return [
		{
			label: "Operate",
			items: [
				{ href: "/dashboard", label: "Operations", icon: Gauge, exact: true },
				{ href: "/dashboard/fleet", label: "Fleet", icon: Plane },
				{ href: "/dashboard/traffic", label: "Traffic", icon: Activity },
				{
					href: "/dashboard/incidents",
					label: "Incidents",
					icon: TriangleAlert,
				},
			],
		},
		{
			label: "Commercial",
			items: [
				{ href: "/dashboard/fares", label: "Fares", icon: Tag },
				{ href: "/dashboard/filings", label: "Filings", icon: ClipboardList },
			],
		},
		{
			label: "Company",
			items: [
				{ href: "/dashboard/brand", label: "Brand & profile", icon: Palette },
				{ href: "/dashboard/crew", label: "Crew", icon: Users },
				{ href: "/dashboard/settings", label: "Settings", icon: Settings },
			],
		},
		{
			label: "Resources",
			items: [
				{ href: "/resources", label: "Guides & tools", icon: BookOpen },
				{
					href: `${uiUrl}/rankings`,
					label: "Model rankings",
					icon: Trophy,
					external: true,
				},
			],
		},
	];
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
	if (item.external) {
		return false;
	}
	if (item.exact) {
		return pathname === item.href;
	}
	return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function findActiveNav(
	groups: NavGroup[],
	pathname: string,
): { group: NavGroup; item: NavItem } | null {
	for (const group of groups) {
		for (const item of group.items) {
			if (isNavItemActive(item, pathname)) {
				return { group, item };
			}
		}
	}
	return null;
}
