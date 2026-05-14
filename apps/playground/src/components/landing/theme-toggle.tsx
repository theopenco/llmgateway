"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

interface ThemeToggleProps {
	className?: string;
	size?: "default" | "compact";
}

export function ThemeToggle({ className, size = "default" }: ThemeToggleProps) {
	const { theme, setTheme, systemTheme } = useTheme();
	const [mounted, setMounted] = useState(false);
	const currentTheme = theme === "system" ? systemTheme : theme;
	const isDark = currentTheme === "dark";
	const sizeClasses =
		size === "compact"
			? {
					root: "h-7 w-14",
					knob: "size-5",
					icon: "size-3.5",
					translate: "translate-x-7",
					negativeTranslate: "-translate-x-7",
				}
			: {
					root: "h-8 w-16",
					knob: "size-6",
					icon: "size-4",
					translate: "translate-x-8",
					negativeTranslate: "-translate-x-8",
				};

	useEffect(() => setMounted(true), []);

	if (!mounted) {
		return (
			<div
				aria-hidden="true"
				className={cn(
					"flex p-1 rounded-full cursor-pointer transition-all duration-300",
					sizeClasses.root,
					"bg-white border border-zinc-200",
					className,
				)}
			>
				<div className="flex justify-between items-center w-full">
					<div
						className={cn(
							"flex justify-center items-center rounded-full transition-transform duration-300 transform bg-gray-200",
							sizeClasses.knob,
							sizeClasses.translate,
						)}
					>
						<Sun
							className={cn(sizeClasses.icon, "text-gray-700")}
							strokeWidth={1.5}
						/>
					</div>
					<div
						className={cn(
							"flex justify-center items-center rounded-full transition-transform duration-300 transform",
							sizeClasses.knob,
							sizeClasses.negativeTranslate,
						)}
					>
						<Moon
							className={cn(sizeClasses.icon, "text-black")}
							strokeWidth={1.5}
						/>
					</div>
				</div>
			</div>
		);
	}

	return (
		<button
			aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
			className={cn(
				"flex p-1 rounded-full cursor-pointer transition-all duration-300",
				sizeClasses.root,
				isDark
					? "bg-zinc-950 border border-zinc-800"
					: "bg-white border border-zinc-200",
				className,
			)}
			onClick={() => setTheme(isDark ? "light" : "dark")}
			type="button"
		>
			<div className="flex justify-between items-center w-full">
				<div
					className={cn(
						"flex justify-center items-center rounded-full transition-transform duration-300",
						sizeClasses.knob,
						isDark
							? "transform translate-x-0 bg-zinc-800"
							: `transform ${sizeClasses.translate} bg-gray-200`,
					)}
				>
					{isDark ? (
						<Moon
							className={cn(sizeClasses.icon, "text-white")}
							strokeWidth={1.5}
						/>
					) : (
						<Sun
							className={cn(sizeClasses.icon, "text-gray-700")}
							strokeWidth={1.5}
						/>
					)}
				</div>
				<div
					className={cn(
						"flex justify-center items-center rounded-full transition-transform duration-300",
						sizeClasses.knob,
						isDark
							? "bg-transparent"
							: `transform ${sizeClasses.negativeTranslate}`,
					)}
				>
					{isDark ? (
						<Sun
							className={cn(sizeClasses.icon, "text-gray-500")}
							strokeWidth={1.5}
						/>
					) : (
						<Moon
							className={cn(sizeClasses.icon, "text-black")}
							strokeWidth={1.5}
						/>
					)}
				</div>
			</div>
		</button>
	);
}
