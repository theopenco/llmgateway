"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

interface ThemeToggleProps {
	className?: string;
	size?: "default" | "compact";
}

const THEME_OPTIONS = [
	{ value: "light", label: "Light", Icon: Sun },
	{ value: "dark", label: "Dark", Icon: Moon },
	{ value: "system", label: "System (default)", Icon: Monitor },
] as const;

export function ThemeToggle({ className, size = "default" }: ThemeToggleProps) {
	const { theme, setTheme } = useTheme();
	const [mounted, setMounted] = useState(false);

	useEffect(() => setMounted(true), []);

	const sizeClasses =
		size === "compact"
			? { root: "h-7 gap-0.5 p-0.5", button: "size-6", icon: "size-3.5" }
			: { root: "h-8 gap-1 p-1", button: "size-6", icon: "size-4" };

	// Default to "system" until mounted to keep SSR markup stable.
	const active = mounted ? (theme ?? "system") : "system";

	return (
		<div
			aria-label="Theme"
			className={cn(
				"inline-flex items-center rounded-full border border-zinc-200 bg-white transition-colors dark:border-zinc-800 dark:bg-zinc-950",
				sizeClasses.root,
				className,
			)}
			role="radiogroup"
		>
			{THEME_OPTIONS.map(({ value, label, Icon }) => {
				const isActive = mounted && active === value;
				return (
					<button
						aria-checked={isActive}
						aria-label={label}
						className={cn(
							"flex items-center justify-center rounded-full transition-colors",
							sizeClasses.button,
							isActive
								? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white"
								: "text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200",
						)}
						key={value}
						onClick={() => setTheme(value)}
						role="radio"
						title={label}
						type="button"
					>
						<Icon className={sizeClasses.icon} strokeWidth={1.5} />
					</button>
				);
			})}
		</div>
	);
}
