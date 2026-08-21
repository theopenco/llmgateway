import {
	AnthropicIcon,
	AutohandIcon,
	ClineIcon,
	DevPassCodeIcon,
	EmpryoIcon,
	OpenCodeIcon,
	SoulForgeIcon,
} from "@llmgateway/shared/components";

export const marqueeTools = [
	{ name: "DevPass Code", icon: DevPassCodeIcon },
	{ name: "Claude Code", icon: AnthropicIcon },
	{ name: "OpenCode", icon: OpenCodeIcon },
	{ name: "Empryo", icon: EmpryoIcon },
	{ name: "SoulForge", icon: SoulForgeIcon },
	{ name: "Autohand", icon: AutohandIcon },
	{ name: "Cline", icon: ClineIcon },
	{ name: "Cursor" },
	{ name: "Aider" },
	{ name: "Continue" },
] as const;
