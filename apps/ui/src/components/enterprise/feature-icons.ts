import {
	BadgeCheck,
	BarChart3,
	Bell,
	BookOpen,
	EyeOff,
	FileSearch,
	GitBranch,
	KeyRound,
	Lock,
	Network,
	Paintbrush,
	Radio,
	ShieldCheck,
	Users,
	Workflow,
} from "lucide-react";

import type { EnterpriseFeatureDefinition } from "@/lib/enterprise-features";
import type { LucideIcon } from "lucide-react";

export const enterpriseFeatureIcons: Record<
	EnterpriseFeatureDefinition["iconName"],
	LucideIcon
> = {
	"shield-check": ShieldCheck,
	"badge-check": BadgeCheck,
	"git-branch": GitBranch,
	audit: FileSearch,
	bell: Bell,
	lock: Lock,
	paintbrush: Paintbrush,
	chart: BarChart3,
	users: Users,
	workflow: Workflow,
	"eye-off": EyeOff,
	network: Network,
	radio: Radio,
	"key-round": KeyRound,
	"book-open": BookOpen,
};
